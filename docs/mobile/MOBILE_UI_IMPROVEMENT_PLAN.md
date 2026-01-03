# ChainlessChain 移动端 UI 完善实施计划

**文档版本**: v1.0
**创建日期**: 2025-12-31
**项目路径**: `mobile-app-uniapp/`
**当前完成度**: 15-20%
**目标完成度**: 60-70% (3-4周内)

---

## 📋 目录

1. [执行概要](#执行概要)
2. [当前状态分析](#当前状态分析)
3. [目标和范围](#目标和范围)
4. [实施阶段](#实施阶段)
5. [详细任务清单](#详细任务清单)
6. [技术实现方案](#技术实现方案)
7. [时间估算和里程碑](#时间估算和里程碑)
8. [资源需求](#资源需求)
9. [风险评估](#风险评估)
10. [验收标准](#验收标准)
11. [后续优化建议](#后续优化建议)

---

## 🎯 执行概要

### 背景

ChainlessChain 移动端（uni-app）是一个基于 Vue 3 + uni-app 的跨平台应用，目标支持 iOS、Android 和 H5。项目已完成基础架构和部分核心功能，但大量 UI 功能尚未实现或仅为 placeholder。

### 核心问题

1. **社交功能**：数据层完成 100%，但 UI 集成为 0%
2. **AI 功能**：当前为模拟实现（30%），需接入真实 LLM
3. **项目管理**：仅有 placeholder（5%）
4. **P2P 网络**：完全未实现（0%）

### 实施目标

- **主要目标**：在 3-4 周内将移动端完成度从 **15-20%** 提升至 **60-70%**
- **核心策略**：优先完成数据层已有的功能 UI 集成（高投入产出比）
- **交付成果**：可用的社交、知识库、AI 对话功能，提供良好的用户体验

---

## 📊 当前状态分析

### 整体完成度矩阵

| 模块 | 数据层 | 业务逻辑 | UI 层 | 总体 | 优先级 |
|-----|--------|---------|-------|------|--------|
| **知识库** | 100% | 95% | 90% | **95%** | P1 |
| **DID 身份** | 100% | 100% | 100% | **100%** | ✅ |
| **认证系统** | 100% | 90% | 85% | **90%** | P2 |
| **AI 对话** | 80% | 40% | 60% | **60%** | P1 |
| **RAG 检索** | 30% | 20% | 10% | **20%** | P2 |
| **好友管理** | 100% | 70% | 0% | **30%** | **P0** |
| **动态发布** | 100% | 70% | 0% | **30%** | **P0** |
| **私密消息** | 90% | 60% | 20% | **40%** | **P0** |
| **交易系统** | 90% | 10% | 5% | **10%** | P3 |
| **项目管理** | 20% | 5% | 5% | **5%** | P3 |
| **备份同步** | 100% | 80% | 70% | **80%** | P2 |
| **P2P 网络** | 0% | 0% | 0% | **0%** | P3 |

### 关键洞察

#### ✅ 优势
1. **DID 身份系统**：完整实现 W3C 标准，100% 完成
2. **知识库功能**：95% 完成，仅缺文件夹 UI
3. **数据库架构**：完善的 19 张表设计，支持双模式（H5/App）
4. **加密安全**：tweetnacl + crypto-js 实现端到端加密
5. **社交数据层**：好友、动态、消息数据层 100% 完成

#### ⚠️ 挑战
1. **UI 与数据层脱节**：社交功能数据层完成但 UI 为 0%
2. **AI 功能模拟**：当前为 mock 实现，需接入真实 LLM
3. **大量 placeholder**：项目管理、交易系统仅有空壳
4. **P2P 未实现**：缺少 libp2p 网络层
5. **无状态管理**：Pinia 已集成但未使用

### 文件统计

- **页面文件**: 44 个 .vue 文件
- **服务层**: 15 个 .js 服务文件
- **路由配置**: 36 个页面路由
- **数据库表**: 19 张表（database.js 108KB）

---

## 🎯 目标和范围

### 总体目标

**在 3-4 周内将移动端完成度从 15-20% 提升至 60-70%**

### 阶段目标

#### Phase 1: 社交功能 UI 集成 (Week 1)
**目标**: 社交功能从 30% → 80%
- 完成好友列表 UI
- 完成动态发布 UI
- 完成私密消息 UI

#### Phase 2: 知识库和 AI 优化 (Week 1-2)
**目标**: 知识库 95% → 100%, AI 60% → 90%
- 补充知识库文件夹 UI
- 接入真实 LLM API
- 实现真实 RAG 检索

#### Phase 3: 消息中心完善 (Week 2)
**目标**: 消息中心 40% → 85%
- 系统通知 UI
- 消息分类筛选
- 未读消息提示

#### Phase 4: 认证体验优化 (Week 3)
**目标**: 认证系统 90% → 95%
- 生物识别集成
- PIN 码体验优化
- 安全设置完善

#### Phase 5: 性能和 UI 打磨 (Week 3-4)
**目标**: 整体用户体验提升
- 主题系统优化
- 动画和过渡效果
- 性能优化
- 错误处理完善

### 范围边界

#### 包含在本计划中 ✅
- 社交功能 UI 集成（好友、动态、消息）
- 知识库 UI 补充（文件夹管理）
- AI 功能真实化（接入真实 LLM）
- 消息中心完善
- 认证体验优化
- UI 主题和性能优化

#### 不包含在本计划中 ❌
- P2P 网络实现（需要单独项目）
- 项目管理模块（仅 5%，优先级低）
- 交易系统业务逻辑（10%，优先级低）
- 智能合约集成（0%，需要区块链专项）
- IPFS 存储（0%，需要分布式存储专项）
- Git 仓库同步（0%，需要单独实现）

---

## 🚀 实施阶段

### Phase 1: 社交功能 UI 集成 (Week 1, 5-6 天)

**优先级**: P0 - 最高优先级
**投入产出比**: ⭐⭐⭐⭐⭐ (数据层已完成 100%)
**预计工时**: 40-50 小时
**关键成果**: 社交功能从 30% → 80%

#### 任务 1.1: 好友列表 UI 集成 (8-10 小时)

**当前状态**: 数据层 100%, UI 0%

**页面清单**:
- `pages/social/friends/friends.vue` - 好友列表主页
- `pages/social/friends/list.vue` - 好友管理列表
- `pages/social/friends/add.vue` - 添加好友
- `pages/social/friends/profile.vue` - 好友资料

**技术方案**:
```javascript
// 1. 在 friends.vue 中集成 friends.js 服务
import friendsService from '@/services/friends.js';

export default {
  data() {
    return {
      friends: [],
      requests: [],
      loading: false
    };
  },
  async onLoad() {
    await this.loadFriends();
    await this.loadRequests();
  },
  methods: {
    async loadFriends() {
      this.loading = true;
      this.friends = await friendsService.getFriendsList();
      this.loading = false;
    },
    async loadRequests() {
      this.requests = await friendsService.getFriendRequests();
    },
    async handleAcceptRequest(requestId) {
      await friendsService.acceptFriendRequest(requestId);
      await this.loadFriends();
      await this.loadRequests();
    }
  }
};
```

**UI 设计要点**:
- 好友列表：头像 + 昵称 + DID（截断）+ 在线状态
- 好友请求：显示待处理数量红点
- 搜索框：支持按 DID 或昵称搜索
- 分组标签：支持好友分组显示

**数据源**: `services/friends.js` 已完成的方法
- `getFriendsList()` - 获取好友列表
- `getFriendRequests()` - 获取好友请求
- `acceptFriendRequest(requestId)` - 接受好友请求
- `rejectFriendRequest(requestId)` - 拒绝好友请求
- `removeFriend(friendDid)` - 删除好友

**验收标准**:
- ✅ 显示当前用户的所有好友
- ✅ 显示待处理的好友请求（带红点提示）
- ✅ 支持接受/拒绝好友请求
- ✅ 支持删除好友
- ✅ 点击好友头像跳转到好友资料页

---

#### 任务 1.2: 添加好友功能 (6-8 小时)

**当前状态**: 数据层 100%, UI 未实现

**页面**: `pages/social/friends/add.vue`

**技术方案**:
```javascript
// 1. DID 二维码扫描
import { scanCode } from '@dcloudio/uni-app';
import friendsService from '@/services/friends.js';
import didService from '@/services/did.js';

export default {
  data() {
    return {
      searchDid: '',
      scanResult: null,
      userInfo: null
    };
  },
  methods: {
    // 扫描 DID 二维码
    async scanDIDQRCode() {
      try {
        const res = await uni.scanCode({
          scanType: ['qrCode']
        });
        this.searchDid = res.result; // DID 字符串
        await this.searchUser();
      } catch (e) {
        uni.showToast({ title: '扫描失败', icon: 'none' });
      }
    },

    // 搜索用户
    async searchUser() {
      if (!this.searchDid) {
        return uni.showToast({ title: '请输入 DID', icon: 'none' });
      }

      // 验证 DID 格式
      if (!this.searchDid.startsWith('did:key:')) {
        return uni.showToast({ title: 'DID 格式错误', icon: 'none' });
      }

      // 模拟查询用户信息（实际需要 P2P 网络查询）
      this.userInfo = {
        did: this.searchDid,
        nickname: '用户' + this.searchDid.slice(-6),
        avatar: '/static/default-avatar.png'
      };
    },

    // 发送好友请求
    async sendFriendRequest() {
      if (!this.userInfo) {
        return uni.showToast({ title: '请先搜索用户', icon: 'none' });
      }

      await friendsService.sendFriendRequest(this.userInfo.did, '你好，我想加你为好友');

      uni.showToast({ title: '好友请求已发送', icon: 'success' });

      setTimeout(() => {
        uni.navigateBack();
      }, 1500);
    }
  }
};
```

**UI 组件**:
1. **搜索框**: 输入 DID 地址
2. **扫码按钮**: 调用 `uni.scanCode()`
3. **用户卡片**: 显示搜索结果（头像、昵称、DID）
4. **添加按钮**: 发送好友请求

**数据源**:
- `services/friends.js`:
  - `sendFriendRequest(friendDid, message)` - 发送好友请求
- `services/did.js`:
  - `getMyDID()` - 获取当前用户 DID（生成二维码）

**验收标准**:
- ✅ 支持手动输入 DID 搜索
- ✅ 支持扫描 DID 二维码
- ✅ 显示用户基本信息
- ✅ 发送好友请求成功
- ✅ 显示"已发送"状态

---

#### 任务 1.3: 动态发布 UI 集成 (10-12 小时)

**当前状态**: 数据层 100%, UI 0%

**页面清单**:
- `pages/social/posts/posts.vue` - 动态广场
- `pages/social/timeline/create.vue` - 创建动态

**技术方案**:
```javascript
// posts.vue - 动态广场
import postsService from '@/services/posts.js';

export default {
  data() {
    return {
      posts: [],
      loading: false,
      page: 1,
      pageSize: 20,
      hasMore: true
    };
  },
  async onLoad() {
    await this.loadPosts();
  },
  async onReachBottom() {
    if (this.hasMore && !this.loading) {
      this.page++;
      await this.loadPosts();
    }
  },
  methods: {
    async loadPosts() {
      this.loading = true;
      const newPosts = await postsService.getTimeline(this.page, this.pageSize);

      if (newPosts.length < this.pageSize) {
        this.hasMore = false;
      }

      this.posts.push(...newPosts);
      this.loading = false;
    },

    async handleLike(postId) {
      await postsService.likePost(postId);
      // 更新本地 UI
      const post = this.posts.find(p => p.id === postId);
      if (post) {
        post.liked = true;
        post.likeCount++;
      }
    },

    async handleUnlike(postId) {
      await postsService.unlikePost(postId);
      const post = this.posts.find(p => p.id === postId);
      if (post) {
        post.liked = false;
        post.likeCount--;
      }
    },

    navigateToComments(postId) {
      uni.navigateTo({
        url: `/pages/social/posts/detail?id=${postId}`
      });
    }
  }
};
```

**动态卡片组件设计**:
```vue
<template>
  <view class="post-card">
    <!-- 头部：用户信息 -->
    <view class="post-header">
      <image :src="post.authorAvatar" class="avatar"></image>
      <view class="user-info">
        <text class="nickname">{{ post.authorName }}</text>
        <text class="time">{{ formatTime(post.createdAt) }}</text>
      </view>
    </view>

    <!-- 内容 -->
    <view class="post-content">
      <text>{{ post.content }}</text>
    </view>

    <!-- 图片（如有） -->
    <view v-if="post.images && post.images.length" class="post-images">
      <image
        v-for="(img, index) in post.images"
        :key="index"
        :src="img"
        mode="aspectFill"
        @click="previewImage(index)"
      ></image>
    </view>

    <!-- 底部交互 -->
    <view class="post-actions">
      <view class="action-btn" @click="handleLike">
        <text :class="['icon', post.liked ? 'liked' : '']">❤️</text>
        <text>{{ post.likeCount }}</text>
      </view>
      <view class="action-btn" @click="navigateToComments">
        <text class="icon">💬</text>
        <text>{{ post.commentCount }}</text>
      </view>
      <view class="action-btn">
        <text class="icon">🔗</text>
        <text>分享</text>
      </view>
    </view>
  </view>
</template>
```

**创建动态功能** (`create.vue`):
```javascript
export default {
  data() {
    return {
      content: '',
      images: [],
      visibility: 'public', // public, friends, private
      maxImages: 9
    };
  },
  methods: {
    async chooseImages() {
      const res = await uni.chooseImage({
        count: this.maxImages - this.images.length,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera']
      });
      this.images.push(...res.tempFilePaths);
    },

    removeImage(index) {
      this.images.splice(index, 1);
    },

    async publish() {
      if (!this.content.trim() && this.images.length === 0) {
        return uni.showToast({ title: '请输入内容或添加图片', icon: 'none' });
      }

      uni.showLoading({ title: '发布中...' });

      try {
        await postsService.createPost({
          content: this.content,
          images: this.images,
          visibility: this.visibility
        });

        uni.hideLoading();
        uni.showToast({ title: '发布成功', icon: 'success' });

        setTimeout(() => {
          uni.navigateBack();
        }, 1500);
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: '发布失败', icon: 'none' });
      }
    }
  }
};
```

**数据源**: `services/posts.js`
- `getTimeline(page, pageSize)` - 获取动态列表
- `createPost({ content, images, visibility })` - 创建动态
- `likePost(postId)` - 点赞
- `unlikePost(postId)` - 取消点赞
- `addComment(postId, content)` - 添加评论
- `getComments(postId)` - 获取评论列表

**验收标准**:
- ✅ 显示动态列表（瀑布流/卡片式）
- ✅ 支持上拉加载更多
- ✅ 支持点赞/取消点赞（带动画）
- ✅ 显示评论数量，点击跳转评论详情
- ✅ 支持发布文本动态
- ✅ 支持发布图片动态（最多 9 张）
- ✅ 支持选择可见性（公开/仅好友/私密）
- ✅ 图片预览功能

---

#### 任务 1.4: 私密消息 UI 完善 (12-15 小时)

**当前状态**: 数据层 90%, UI 20%, 加密层完成

**页面清单**:
- `pages/social/messages/messages.vue` - 消息列表
- `pages/social/friend-chat/friend-chat.vue` - 聊天界面

**技术方案**:
```javascript
// messages.vue - 消息列表
import messagingService from '@/services/messaging.js';
import didService from '@/services/did.js';

export default {
  data() {
    return {
      conversations: [],
      loading: false
    };
  },
  async onLoad() {
    await this.loadConversations();
  },
  async onShow() {
    // 每次显示时刷新
    await this.loadConversations();
  },
  methods: {
    async loadConversations() {
      this.loading = true;
      this.conversations = await messagingService.getConversations();
      this.loading = false;
    },

    navigateToChat(friendDid) {
      uni.navigateTo({
        url: `/pages/social/friend-chat/friend-chat?friendDid=${friendDid}`
      });
    },

    formatLastMessage(msg) {
      if (msg.type === 'text') {
        return msg.content;
      } else if (msg.type === 'image') {
        return '[图片]';
      }
      return '';
    },

    formatTime(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;

      if (diff < 60000) return '刚刚';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
      return new Date(timestamp).toLocaleDateString();
    }
  }
};
```

**聊天界面实现** (`friend-chat.vue`):
```javascript
import messagingService from '@/services/messaging.js';
import encryptionManager from '@/services/encryption-manager.js';

export default {
  data() {
    return {
      friendDid: '',
      messages: [],
      inputText: '',
      loading: false,
      page: 1,
      pageSize: 50
    };
  },
  async onLoad(options) {
    this.friendDid = options.friendDid;
    await this.loadMessages();
    this.scrollToBottom();
  },
  methods: {
    async loadMessages() {
      this.loading = true;
      const msgs = await messagingService.getMessages(this.friendDid, this.page, this.pageSize);

      // 解密消息
      for (const msg of msgs) {
        if (msg.encrypted) {
          msg.content = await encryptionManager.decryptMessage(
            msg.content,
            this.friendDid
          );
        }
      }

      this.messages = msgs.reverse(); // 最新的在下面
      this.loading = false;
    },

    async sendMessage() {
      if (!this.inputText.trim()) {
        return;
      }

      const content = this.inputText.trim();
      this.inputText = '';

      // 加密消息
      const encryptedContent = await encryptionManager.encryptMessage(
        content,
        this.friendDid
      );

      // 发送
      const message = await messagingService.sendMessage({
        recipientDid: this.friendDid,
        content: encryptedContent,
        type: 'text',
        encrypted: true
      });

      // 添加到本地显示
      this.messages.push({
        ...message,
        content: content, // 显示解密后的内容
        isSelf: true
      });

      this.scrollToBottom();
    },

    async sendImage() {
      const res = await uni.chooseImage({
        count: 1,
        sizeType: ['compressed']
      });

      const imagePath = res.tempFilePaths[0];

      // TODO: 上传图片到云存储，获取 URL
      // 这里简化处理
      const message = await messagingService.sendMessage({
        recipientDid: this.friendDid,
        content: imagePath,
        type: 'image',
        encrypted: false
      });

      this.messages.push({
        ...message,
        isSelf: true
      });

      this.scrollToBottom();
    },

    scrollToBottom() {
      this.$nextTick(() => {
        uni.pageScrollTo({
          scrollTop: 999999,
          duration: 300
        });
      });
    },

    previewImage(url) {
      uni.previewImage({
        urls: [url],
        current: url
      });
    }
  }
};
```

**聊天气泡组件设计**:
```vue
<template>
  <view class="chat-container">
    <!-- 消息列表 -->
    <scroll-view
      scroll-y
      class="message-list"
      :scroll-into-view="'msg-' + messages.length"
    >
      <view
        v-for="(msg, index) in messages"
        :key="index"
        :id="'msg-' + index"
        :class="['message-item', msg.isSelf ? 'self' : 'other']"
      >
        <!-- 头像 -->
        <image :src="msg.avatar" class="avatar"></image>

        <!-- 消息内容 -->
        <view class="message-bubble">
          <!-- 文本消息 -->
          <text v-if="msg.type === 'text'" class="message-text">
            {{ msg.content }}
          </text>

          <!-- 图片消息 -->
          <image
            v-if="msg.type === 'image'"
            :src="msg.content"
            mode="aspectFill"
            class="message-image"
            @click="previewImage(msg.content)"
          ></image>

          <!-- 时间戳 -->
          <text class="message-time">{{ formatTime(msg.timestamp) }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- 输入框 -->
    <view class="input-bar">
      <image
        src="/static/icons/image.png"
        class="tool-btn"
        @click="sendImage"
      ></image>

      <input
        v-model="inputText"
        class="message-input"
        placeholder="输入消息..."
        confirm-type="send"
        @confirm="sendMessage"
      />

      <button
        class="send-btn"
        :disabled="!inputText.trim()"
        @click="sendMessage"
      >
        发送
      </button>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.chat-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.message-list {
  flex: 1;
  padding: 20rpx;
}

.message-item {
  display: flex;
  margin-bottom: 30rpx;

  &.self {
    flex-direction: row-reverse;

    .message-bubble {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
  }

  &.other {
    .message-bubble {
      background: white;
      color: #333;
    }
  }
}

.avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  margin: 0 20rpx;
}

.message-bubble {
  max-width: 500rpx;
  padding: 20rpx;
  border-radius: 16rpx;
  position: relative;
}

.message-text {
  font-size: 28rpx;
  line-height: 1.5;
  word-wrap: break-word;
}

.message-image {
  max-width: 400rpx;
  max-height: 400rpx;
  border-radius: 8rpx;
}

.message-time {
  font-size: 20rpx;
  opacity: 0.6;
  margin-top: 10rpx;
  display: block;
}

.input-bar {
  display: flex;
  align-items: center;
  padding: 20rpx;
  background: white;
  border-top: 1rpx solid #eee;
}

.tool-btn {
  width: 60rpx;
  height: 60rpx;
  margin-right: 20rpx;
}

.message-input {
  flex: 1;
  height: 70rpx;
  padding: 0 20rpx;
  background: #f5f5f5;
  border-radius: 35rpx;
  font-size: 28rpx;
}

.send-btn {
  margin-left: 20rpx;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8rpx;
  padding: 0 30rpx;
  height: 70rpx;
  line-height: 70rpx;

  &:disabled {
    opacity: 0.5;
  }
}
</style>
```

**端到端加密实现**:
```javascript
// services/encryption-manager.js 已实现
// 使用 tweetnacl 的 X25519 密钥协商 + NaCl SecretBox 加密

export default {
  // 加密消息
  async encryptMessage(plaintext, recipientDid) {
    // 1. 获取接收者的公钥
    const recipientPublicKey = await this.getPublicKey(recipientDid);

    // 2. 使用自己的私钥和对方的公钥进行 ECDH 密钥协商
    const sharedSecret = this.computeSharedSecret(recipientPublicKey);

    // 3. 使用共享密钥加密消息
    const encrypted = nacl.secretbox(
      nacl.util.decodeUTF8(plaintext),
      this.generateNonce(),
      sharedSecret
    );

    return nacl.util.encodeBase64(encrypted);
  },

  // 解密消息
  async decryptMessage(ciphertext, senderDid) {
    const senderPublicKey = await this.getPublicKey(senderDid);
    const sharedSecret = this.computeSharedSecret(senderPublicKey);

    const decrypted = nacl.secretbox.open(
      nacl.util.decodeBase64(ciphertext),
      this.extractNonce(ciphertext),
      sharedSecret
    );

    return nacl.util.encodeUTF8(decrypted);
  }
};
```

**数据源**: `services/messaging.js`
- `getConversations()` - 获取会话列表
- `getMessages(friendDid, page, pageSize)` - 获取消息记录
- `sendMessage({ recipientDid, content, type })` - 发送消息
- `markAsRead(friendDid)` - 标记已读

**验收标准**:
- ✅ 显示会话列表（最后一条消息预览）
- ✅ 显示未读消息数量（红点）
- ✅ 支持发送文本消息
- ✅ 支持发送图片消息
- ✅ 消息端到端加密
- ✅ 自己的消息靠右，对方的消息靠左
- ✅ 自动滚动到最新消息
- ✅ 支持图片预览
- ✅ 显示消息时间戳
- ✅ 消息发送失败提示

---

### Phase 2: 知识库和 AI 优化 (Week 1-2, 4-5 天)

**优先级**: P1 - 高优先级
**投入产出比**: ⭐⭐⭐⭐
**预计工时**: 30-40 小时
**关键成果**: 知识库 95% → 100%, AI 60% → 90%

#### 任务 2.1: 知识库文件夹 UI (8-10 小时)

**当前状态**: 数据层 100%, UI 缺失

**页面**: `pages/knowledge/folders/folders.vue`

**技术方案**:
```javascript
import { db } from '@/services/database.js';

export default {
  data() {
    return {
      folders: [],
      selectedFolder: null,
      knowledgeItems: [],
      showCreateDialog: false,
      newFolderName: ''
    };
  },
  async onLoad() {
    await this.loadFolders();
  },
  methods: {
    async loadFolders() {
      this.folders = await db.getFolders();
    },

    async loadKnowledgeItems(folderId) {
      this.selectedFolder = folderId;
      this.knowledgeItems = await db.getKnowledgeByFolder(folderId);
    },

    async createFolder() {
      if (!this.newFolderName.trim()) {
        return uni.showToast({ title: '请输入文件夹名称', icon: 'none' });
      }

      await db.createFolder({
        name: this.newFolderName,
        color: this.getRandomColor(),
        icon: '📁'
      });

      this.showCreateDialog = false;
      this.newFolderName = '';
      await this.loadFolders();
    },

    async moveToFolder(knowledgeId, folderId) {
      await db.moveKnowledgeToFolder(knowledgeId, folderId);
      await this.loadKnowledgeItems(this.selectedFolder);
    },

    getRandomColor() {
      const colors = ['#667eea', '#f093fb', '#4facfe', '#43e97b', '#fa709a'];
      return colors[Math.floor(Math.random() * colors.length)];
    }
  }
};
```

**UI 设计**:
- 左侧：文件夹列表（带图标和颜色）
- 右侧：文件夹内的知识条目
- 支持拖拽移动（长按选择）
- 支持新建/重命名/删除文件夹

**验收标准**:
- ✅ 显示所有文件夹
- ✅ 点击文件夹显示内部知识条目
- ✅ 支持创建新文件夹
- ✅ 支持重命名文件夹
- ✅ 支持删除文件夹（提示是否移动内容）
- ✅ 支持移动知识条目到文件夹
- ✅ 显示文件夹内条目数量

---

#### 任务 2.2: 接入真实 LLM API (8-10 小时)

**当前状态**: llm.js 100% 完成，ai.js 为模拟实现

**目标**: 将 `services/ai.js` 中的模拟函数替换为真实 LLM 调用

**技术方案**:
```javascript
// services/ai.js
import llmService from './llm.js';

export default {
  // 之前是模拟实现，现在改为真实调用
  async generateSummary(text) {
    if (!text || text.length < 50) {
      return text;
    }

    const prompt = `请为以下内容生成一个简洁的摘要（不超过100字）：\n\n${text}`;

    const response = await llmService.chat({
      model: llmService.getCurrentModel(),
      messages: [
        { role: 'system', content: '你是一个专业的内容摘要助手。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 200
    });

    return response.content.trim();
  },

  async suggestTags(text) {
    const prompt = `请为以下内容推荐3-5个标签（用逗号分隔）：\n\n${text}`;

    const response = await llmService.chat({
      model: llmService.getCurrentModel(),
      messages: [
        { role: 'system', content: '你是一个内容标签推荐助手。只返回标签，用逗号分隔。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 50
    });

    return response.content.split(',').map(tag => tag.trim());
  },

  async expandContent(text) {
    const prompt = `请扩展以下内容，使其更加详细和丰富：\n\n${text}`;

    const response = await llmService.chat({
      model: llmService.getCurrentModel(),
      messages: [
        { role: 'system', content: '你是一个内容扩展助手，帮助用户丰富内容细节。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    });

    return response.content.trim();
  },

  async polishContent(text) {
    const prompt = `请润色以下内容，使其更加流畅和专业：\n\n${text}`;

    const response = await llmService.chat({
      model: llmService.getCurrentModel(),
      messages: [
        { role: 'system', content: '你是一个内容润色助手。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 1500
    });

    return response.content.trim();
  }
};
```

**配置管理** (`llm.js` 已实现):
```javascript
// 用户可以在设置中配置 LLM 提供商
export default {
  providers: {
    openai: { name: 'OpenAI', baseURL: 'https://api.openai.com/v1' },
    deepseek: { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1' },
    qwen: { name: '通义千问', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    // ... 10+ 提供商
  },

  async chat({ model, messages, temperature, max_tokens }) {
    const config = this.getConfig();

    const response = await uni.request({
      url: `${config.baseURL}/chat/completions`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      data: {
        model: model || config.defaultModel,
        messages: messages,
        temperature: temperature || 0.7,
        max_tokens: max_tokens || 1000
      }
    });

    return {
      content: response.data.choices[0].message.content,
      usage: response.data.usage
    };
  }
};
```

**验收标准**:
- ✅ 智能摘要返回真实结果
- ✅ 标签建议返回真实标签
- ✅ 内容扩展返回真实扩展内容
- ✅ 内容润色返回真实润色结果
- ✅ 支持用户配置 LLM 提供商和 API Key
- ✅ 显示 Token 使用情况

---

#### 任务 2.3: 实现真实 RAG 检索 (12-15 小时)

**当前状态**: knowledge-rag.js 为模拟实现（20%）

**目标**: 集成 transformers.js 实现真实的向量化和语义搜索

**技术挑战**: uni-app 环境限制，transformers.js 可能无法直接运行

**方案选择**:

**方案 A**: 云端 RAG 服务（推荐）
```javascript
// 调用后端 ai-service 的 RAG API
export default {
  async semanticSearch(query, topK = 5) {
    const response = await uni.request({
      url: 'http://localhost:8001/api/rag/search',
      method: 'POST',
      data: {
        query: query,
        top_k: topK,
        filters: {}
      }
    });

    return response.data.results;
  }
};
```

**方案 B**: 本地 Embedding（仅 H5 支持）
```javascript
// 使用 transformers.js（仅浏览器环境）
import { pipeline } from '@xenova/transformers';

let embedder = null;

async function initEmbedder() {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return embedder;
}

export default {
  async generateEmbedding(text) {
    // #ifdef H5
    const model = await initEmbedder();
    const output = await model(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
    // #endif

    // #ifdef APP-PLUS
    // App 环境调用云端 API
    return await this.generateEmbeddingRemote(text);
    // #endif
  },

  async semanticSearch(query, topK = 5) {
    const queryEmbedding = await this.generateEmbedding(query);

    // 从数据库获取所有知识条目的 embedding
    const allItems = await db.getAllKnowledge();

    // 计算余弦相似度
    const results = allItems.map(item => ({
      ...item,
      similarity: this.cosineSimilarity(queryEmbedding, item.embedding)
    }));

    // 排序并返回 topK
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  },

  cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }
};
```

**数据库扩展**:
```javascript
// 在 database.js 中添加 embedding 字段
await db.executeSql(`
  ALTER TABLE knowledge_items
  ADD COLUMN embedding TEXT
`);

// 保存知识时同时保存 embedding
async saveKnowledge(data) {
  const embedding = await ragService.generateEmbedding(data.content);

  await db.executeSql(`
    INSERT INTO knowledge_items (title, content, embedding, created_at)
    VALUES (?, ?, ?, ?)
  `, [data.title, data.content, JSON.stringify(embedding), Date.now()]);
}
```

**验收标准**:
- ✅ 输入查询关键词，返回语义相关的知识条目
- ✅ 相似度排序正确
- ✅ 支持中文语义搜索
- ✅ 响应时间 < 2 秒
- ✅ 准确率 > 70%（手动测试）

---

### Phase 3: 消息中心完善 (Week 2, 2-3 天)

**优先级**: P2
**预计工时**: 15-20 小时
**关键成果**: 消息中心 40% → 85%

#### 任务 3.1: 系统通知 UI (8-10 小时)

**页面**: `pages/messages/index.vue`

**通知类型**:
1. 好友请求通知
2. 评论通知
3. 点赞通知
4. 系统公告
5. 安全提醒

**技术方案**:
```javascript
export default {
  data() {
    return {
      notifications: [],
      filter: 'all', // all, friend, comment, like, system
      unreadCount: 0
    };
  },
  async onLoad() {
    await this.loadNotifications();
  },
  methods: {
    async loadNotifications() {
      const allNotifications = await db.getNotifications();

      // 按类型分类
      this.notifications = allNotifications.map(n => ({
        ...n,
        icon: this.getNotificationIcon(n.type),
        color: this.getNotificationColor(n.type)
      }));

      this.unreadCount = this.notifications.filter(n => !n.read).length;
    },

    getNotificationIcon(type) {
      const icons = {
        friend_request: '👋',
        comment: '💬',
        like: '❤️',
        system: '🔔',
        security: '🔒'
      };
      return icons[type] || '📢';
    },

    async markAsRead(notificationId) {
      await db.markNotificationAsRead(notificationId);
      await this.loadNotifications();
    },

    async handleNotificationClick(notification) {
      // 标记为已读
      await this.markAsRead(notification.id);

      // 跳转到相应页面
      switch (notification.type) {
        case 'friend_request':
          uni.navigateTo({ url: '/pages/social/friends/list' });
          break;
        case 'comment':
        case 'like':
          uni.navigateTo({ url: `/pages/social/posts/detail?id=${notification.relatedId}` });
          break;
        case 'system':
          // 显示详情弹窗
          this.showNotificationDetail(notification);
          break;
      }
    }
  }
};
```

**UI 设计**:
```vue
<template>
  <view class="notifications-page">
    <!-- 顶部筛选 -->
    <view class="filter-tabs">
      <view
        v-for="tab in filterTabs"
        :key="tab.value"
        :class="['tab', filter === tab.value ? 'active' : '']"
        @click="filter = tab.value"
      >
        {{ tab.label }}
        <view v-if="tab.count > 0" class="badge">{{ tab.count }}</view>
      </view>
    </view>

    <!-- 通知列表 -->
    <scroll-view scroll-y class="notification-list">
      <view
        v-for="item in filteredNotifications"
        :key="item.id"
        :class="['notification-item', !item.read ? 'unread' : '']"
        @click="handleNotificationClick(item)"
      >
        <view class="icon-box" :style="{ background: item.color }">
          <text class="icon">{{ item.icon }}</text>
        </view>

        <view class="content">
          <text class="title">{{ item.title }}</text>
          <text class="message">{{ item.message }}</text>
          <text class="time">{{ formatTime(item.timestamp) }}</text>
        </view>

        <view v-if="!item.read" class="unread-dot"></view>
      </view>
    </scroll-view>
  </view>
</template>
```

**数据库扩展**:
```javascript
// 在 database.js 中添加通知表
await db.executeSql(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    related_id TEXT,
    read INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL
  )
`);
```

**验收标准**:
- ✅ 显示所有类型的通知
- ✅ 支持按类型筛选
- ✅ 显示未读数量红点
- ✅ 点击通知跳转到相应页面
- ✅ 支持标记为已读
- ✅ 支持一键全部已读
- ✅ 显示时间（刚刚/几分钟前/几小时前）

---

#### 任务 3.2: 消息分类和筛选 (4-5 小时)

**功能**:
- 未读消息优先显示
- 按好友/群组分类
- 搜索消息内容
- 消息置顶

**技术方案**:
```javascript
export default {
  data() {
    return {
      searchKeyword: '',
      sortBy: 'time', // time, unread
      pinnedConversations: []
    };
  },
  computed: {
    sortedConversations() {
      let list = [...this.conversations];

      // 搜索过滤
      if (this.searchKeyword) {
        list = list.filter(c =>
          c.friendName.includes(this.searchKeyword) ||
          c.lastMessage.content.includes(this.searchKeyword)
        );
      }

      // 置顶优先
      list.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;

        // 按未读或时间排序
        if (this.sortBy === 'unread') {
          return b.unreadCount - a.unreadCount;
        } else {
          return b.lastMessage.timestamp - a.lastMessage.timestamp;
        }
      });

      return list;
    }
  },
  methods: {
    async togglePin(conversationId) {
      await db.toggleConversationPin(conversationId);
      await this.loadConversations();
    }
  }
};
```

**验收标准**:
- ✅ 支持搜索消息内容
- ✅ 支持按时间/未读数排序
- ✅ 支持消息置顶
- ✅ 置顶消息显示在最上方

---

#### 任务 3.3: 未读消息提示 (3-4 小时)

**功能**:
- TabBar 显示未读红点
- 消息列表显示未读数量
- 聊天界面显示未读位置

**技术方案**:
```javascript
// 在 App.vue 中全局监听未读消息
export default {
  async onShow() {
    await this.updateUnreadCount();
  },
  methods: {
    async updateUnreadCount() {
      const count = await db.getUnreadMessageCount();

      if (count > 0) {
        uni.setTabBarBadge({
          index: 2, // 消息 Tab
          text: count > 99 ? '99+' : String(count)
        });
      } else {
        uni.removeTabBarBadge({ index: 2 });
      }
    }
  }
};
```

**验收标准**:
- ✅ TabBar 显示未读消息数量
- ✅ 消息列表每个会话显示未读数量
- ✅ 进入聊天后自动标记为已读
- ✅ 未读消息数量实时更新

---

### Phase 4: 认证体验优化 (Week 3, 2-3 天)

**优先级**: P2
**预计工时**: 15-20 小时
**关键成果**: 认证系统 90% → 95%

#### 任务 4.1: 生物识别集成 (8-10 小时)

**页面**: `pages/auth/biometric-setup.vue`

**技术方案**:
```javascript
export default {
  data() {
    return {
      biometricType: '', // fingerprint, face
      available: false,
      enrolled: false
    };
  },
  async onLoad() {
    await this.checkBiometric();
  },
  methods: {
    async checkBiometric() {
      // uni-app 生物识别 API
      uni.checkIsSupportSoterAuthentication({
        success: (res) => {
          this.available = res.supportMode.length > 0;

          if (res.supportMode.includes('fingerprint')) {
            this.biometricType = 'fingerprint';
          } else if (res.supportMode.includes('facial')) {
            this.biometricType = 'face';
          }
        }
      });

      // 检查是否已录入
      uni.checkIsSoterEnrolledInDevice({
        checkAuthMode: this.biometricType,
        success: (res) => {
          this.enrolled = res.isEnrolled;
        }
      });
    },

    async enableBiometric() {
      if (!this.enrolled) {
        return uni.showModal({
          title: '提示',
          content: '请先在系统设置中录入生物识别信息',
          showCancel: false
        });
      }

      // 首次启用需要验证 PIN 码
      uni.navigateTo({
        url: '/pages/auth/verify-pin?action=enable_biometric'
      });
    },

    async authenticate() {
      return new Promise((resolve, reject) => {
        uni.startSoterAuthentication({
          requestAuthModes: [this.biometricType],
          challenge: this.generateChallenge(),
          authContent: '验证以访问 ChainlessChain',
          success: (res) => {
            resolve(res);
          },
          fail: (err) => {
            reject(err);
          }
        });
      });
    },

    generateChallenge() {
      return String(Date.now() + Math.random());
    }
  }
};
```

**登录流程优化**:
```javascript
// pages/login/login.vue
export default {
  async onLoad() {
    const biometricEnabled = await db.getBiometricSetting();

    if (biometricEnabled) {
      // 显示生物识别登录选项
      this.showBiometricLogin = true;
    }
  },
  async loginWithBiometric() {
    try {
      await this.authenticate();

      // 验证成功，直接进入应用
      uni.reLaunch({ url: '/pages/index/index' });
    } catch (e) {
      uni.showToast({ title: '验证失败', icon: 'none' });
    }
  }
};
```

**验收标准**:
- ✅ 检测设备是否支持生物识别
- ✅ 支持指纹识别
- ✅ 支持面部识别
- ✅ 启用生物识别需要先验证 PIN 码
- ✅ 登录时优先显示生物识别
- ✅ 生物识别失败时降级到 PIN 码

---

#### 任务 4.2: PIN 码体验优化 (4-5 小时)

**优化点**:
1. PIN 码输入组件美化
2. 错误提示动画
3. 支持忘记 PIN 码（通过备份恢复）
4. 支持 PIN 码强度检测

**技术方案**:
```vue
<!-- PIN 码输入组件 -->
<template>
  <view class="pin-input-container">
    <view class="pin-dots">
      <view
        v-for="i in 6"
        :key="i"
        :class="['dot', pin.length >= i ? 'filled' : '']"
      ></view>
    </view>

    <view class="keyboard">
      <view
        v-for="num in [1,2,3,4,5,6,7,8,9,'',0,'⌫']"
        :key="num"
        :class="['key', num === '' ? 'empty' : '']"
        @click="handleKeyPress(num)"
      >
        {{ num }}
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      pin: '',
      maxLength: 6
    };
  },
  methods: {
    handleKeyPress(key) {
      if (key === '') return;

      if (key === '⌫') {
        this.pin = this.pin.slice(0, -1);
      } else if (this.pin.length < this.maxLength) {
        this.pin += key;

        if (this.pin.length === this.maxLength) {
          this.$emit('complete', this.pin);
        }
      }
    },

    shake() {
      // 错误时震动动画
      this.$refs.dots.classList.add('shake');
      setTimeout(() => {
        this.$refs.dots.classList.remove('shake');
      }, 500);
    }
  }
};
</script>

<style lang="scss" scoped>
.pin-dots {
  display: flex;
  justify-content: center;
  gap: 20rpx;
  margin-bottom: 80rpx;

  &.shake {
    animation: shake 0.5s;
  }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  10%, 30%, 50%, 70%, 90% { transform: translateX(-10rpx); }
  20%, 40%, 60%, 80% { transform: translateX(10rpx); }
}

.dot {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid #ccc;
  transition: all 0.3s;

  &.filled {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-color: #667eea;
  }
}

.keyboard {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20rpx;
  padding: 40rpx;
}

.key {
  height: 120rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 16rpx;
  font-size: 48rpx;
  font-weight: 500;
  transition: all 0.2s;

  &:active:not(.empty) {
    background: #e0e0e0;
    transform: scale(0.95);
  }

  &.empty {
    background: transparent;
  }
}
</style>
```

**验收标准**:
- ✅ 使用自定义数字键盘
- ✅ 输入时显示圆点填充动画
- ✅ 错误时震动反馈
- ✅ 支持删除键
- ✅ PIN 码强度提示（设置时）
- ✅ 忘记 PIN 码可通过备份恢复

---

#### 任务 4.3: 安全设置完善 (3-4 小时)

**页面**: `pages/settings/security.vue`

**功能清单**:
1. 修改 PIN 码
2. 启用/禁用生物识别
3. 自动锁定设置（5分钟/10分钟/30分钟）
4. 显示登录历史
5. 管理已登录设备

**技术方案**:
```javascript
export default {
  data() {
    return {
      autoLockTime: 300000, // 5分钟
      biometricEnabled: false,
      loginHistory: []
    };
  },
  async onLoad() {
    await this.loadSecuritySettings();
  },
  methods: {
    async loadSecuritySettings() {
      const settings = await db.getSecuritySettings();
      this.autoLockTime = settings.autoLockTime;
      this.biometricEnabled = settings.biometricEnabled;
      this.loginHistory = await db.getLoginHistory(10);
    },

    async changeAutoLockTime(time) {
      this.autoLockTime = time;
      await db.updateSecuritySettings({ autoLockTime: time });
    },

    async toggleBiometric() {
      if (this.biometricEnabled) {
        // 禁用生物识别
        await db.updateSecuritySettings({ biometricEnabled: false });
        this.biometricEnabled = false;
      } else {
        // 启用生物识别（需要验证 PIN）
        uni.navigateTo({
          url: '/pages/auth/biometric-setup'
        });
      }
    },

    navigateToChangePIN() {
      uni.navigateTo({
        url: '/pages/auth/change-pin'
      });
    }
  }
};
```

**验收标准**:
- ✅ 显示当前安全设置
- ✅ 支持修改自动锁定时间
- ✅ 显示最近 10 次登录记录
- ✅ 支持一键锁定应用

---

### Phase 5: 性能和 UI 打磨 (Week 3-4, 3-4 天)

**优先级**: P2
**预计工时**: 20-25 小时
**关键成果**: 提升整体用户体验

#### 任务 5.1: 主题系统优化 (6-8 小时)

**当前状态**: 已有浅色/深色主题，但部分页面未适配

**目标**: 确保所有页面支持主题切换

**技术方案**:
```scss
// styles/theme.scss
:root {
  // 浅色主题
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #333333;
  --text-secondary: #666666;
  --border-color: #e0e0e0;
  --brand-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

[data-theme='dark'] {
  // 深色主题
  --bg-primary: #1a1a1a;
  --bg-secondary: #2d2d2d;
  --text-primary: #ffffff;
  --text-secondary: #aaaaaa;
  --border-color: #404040;
  --brand-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

// 使用示例
.page {
  background-color: var(--bg-primary);
  color: var(--text-primary);
}
```

**主题切换逻辑**:
```javascript
// App.vue
export default {
  onLaunch() {
    this.applyTheme();
  },
  methods: {
    applyTheme() {
      const theme = uni.getStorageSync('theme') || 'auto';

      if (theme === 'auto') {
        // 跟随系统
        const systemTheme = uni.getSystemInfoSync().theme || 'light';
        this.setTheme(systemTheme);
      } else {
        this.setTheme(theme);
      }
    },

    setTheme(theme) {
      const root = document.documentElement;
      root.setAttribute('data-theme', theme);
      uni.setStorageSync('current-theme', theme);
    }
  }
};
```

**验收标准**:
- ✅ 所有页面支持浅色/深色主题
- ✅ 主题切换无闪烁
- ✅ 品牌色在两种主题下都清晰可见
- ✅ 支持跟随系统主题

---

#### 任务 5.2: 动画和过渡效果 (6-8 小时)

**优化点**:
1. 页面切换过渡动画
2. 列表项加载动画
3. 按钮点击反馈
4. 下拉刷新动画
5. 加载骨架屏

**技术方案**:
```vue
<!-- 骨架屏组件 -->
<template>
  <view class="skeleton">
    <view class="skeleton-avatar"></view>
    <view class="skeleton-content">
      <view class="skeleton-line"></view>
      <view class="skeleton-line short"></view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.skeleton {
  display: flex;
  padding: 30rpx;

  &-avatar {
    width: 80rpx;
    height: 80rpx;
    border-radius: 50%;
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  &-content {
    flex: 1;
    margin-left: 20rpx;
  }

  &-line {
    height: 32rpx;
    background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
    border-radius: 4rpx;
    margin-bottom: 20rpx;

    &.short {
      width: 60%;
    }
  }
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
```

**页面切换动画**:
```javascript
// pages.json
{
  "globalStyle": {
    "navigationStyle": "custom",
    "animationType": "pop-in",
    "animationDuration": 300
  }
}
```

**列表加载动画**:
```vue
<template>
  <view
    v-for="(item, index) in items"
    :key="item.id"
    class="list-item"
    :style="{ animationDelay: `${index * 50}ms` }"
  >
    {{ item.title }}
  </view>
</template>

<style lang="scss" scoped>
.list-item {
  animation: fadeInUp 0.3s ease-out forwards;
  opacity: 0;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20rpx);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
```

**验收标准**:
- ✅ 页面切换流畅（60fps）
- ✅ 列表项依次出现动画
- ✅ 按钮点击有缩放反馈
- ✅ 加载时显示骨架屏
- ✅ 下拉刷新有流畅动画

---

#### 任务 5.3: 性能优化 (4-5 小时)

**优化点**:
1. 图片懒加载
2. 虚拟列表（长列表优化）
3. 防抖和节流
4. 数据库查询优化
5. 内存泄漏检测

**技术方案**:
```javascript
// utils/lazyLoad.js
export function lazyLoadImages() {
  const images = document.querySelectorAll('image[lazy]');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        observer.unobserve(img);
      }
    });
  });

  images.forEach(img => observer.observe(img));
}

// utils/debounce.js
export function debounce(fn, delay = 300) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

// utils/throttle.js
export function throttle(fn, delay = 300) {
  let lastTime = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastTime >= delay) {
      fn.apply(this, args);
      lastTime = now;
    }
  };
}
```

**搜索防抖示例**:
```javascript
import { debounce } from '@/utils/debounce.js';

export default {
  data() {
    return {
      searchKeyword: ''
    };
  },
  watch: {
    searchKeyword: debounce(async function(newVal) {
      await this.performSearch(newVal);
    }, 500)
  }
};
```

**数据库查询优化**:
```javascript
// 使用索引
await db.executeSql(`
  CREATE INDEX IF NOT EXISTS idx_created_at
  ON knowledge_items(created_at DESC)
`);

// 分页查询
async getKnowledgeList(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  return await db.executeSql(`
    SELECT * FROM knowledge_items
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [pageSize, offset]);
}
```

**验收标准**:
- ✅ 图片懒加载生效
- ✅ 长列表滚动流畅（虚拟列表）
- ✅ 搜索输入有防抖
- ✅ 滚动事件有节流
- ✅ 数据库查询有索引
- ✅ 应用启动时间 < 2 秒
- ✅ 内存占用稳定（无泄漏）

---

#### 任务 5.4: 错误处理完善 (4-5 小时)

**优化点**:
1. 全局错误拦截
2. 友好的错误提示
3. 离线状态提示
4. 数据加载失败重试
5. 崩溃日志收集

**技术方案**:
```javascript
// utils/errorHandler.js
export default {
  install(app) {
    // Vue 错误处理
    app.config.errorHandler = (err, vm, info) => {
      console.error('[Vue Error]', err, info);
      this.reportError(err, 'vue');
    };

    // Promise 错误处理
    window.addEventListener('unhandledrejection', (event) => {
      console.error('[Promise Error]', event.reason);
      this.reportError(event.reason, 'promise');
    });
  },

  reportError(error, type) {
    // 收集错误信息
    const errorLog = {
      message: error.message || String(error),
      stack: error.stack,
      type: type,
      timestamp: Date.now(),
      userAgent: navigator.userAgent
    };

    // 保存到本地
    uni.setStorageSync('error-logs', [
      ...(uni.getStorageSync('error-logs') || []).slice(-50),
      errorLog
    ]);

    // 显示友好提示
    uni.showToast({
      title: '操作失败，请稍后重试',
      icon: 'none'
    });
  }
};
```

**网络错误拦截**:
```javascript
// utils/request.js
export function request(options) {
  return new Promise((resolve, reject) => {
    uni.request({
      ...options,
      success: (res) => {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else {
          this.handleError(res.statusCode);
          reject(res);
        }
      },
      fail: (err) => {
        this.handleNetworkError(err);
        reject(err);
      }
    });
  });
}

function handleError(statusCode) {
  const messages = {
    400: '请求参数错误',
    401: '未授权，请重新登录',
    403: '拒绝访问',
    404: '请求资源不存在',
    500: '服务器错误',
    502: '网关错误',
    503: '服务不可用'
  };

  uni.showToast({
    title: messages[statusCode] || '请求失败',
    icon: 'none'
  });
}

function handleNetworkError(err) {
  if (err.errMsg.includes('timeout')) {
    uni.showToast({ title: '请求超时', icon: 'none' });
  } else {
    uni.showToast({ title: '网络连接失败', icon: 'none' });
  }
}
```

**离线状态检测**:
```javascript
// App.vue
export default {
  onLaunch() {
    this.checkNetworkStatus();

    // 监听网络状态变化
    uni.onNetworkStatusChange((res) => {
      if (!res.isConnected) {
        this.showOfflineMessage();
      }
    });
  },
  methods: {
    checkNetworkStatus() {
      uni.getNetworkType({
        success: (res) => {
          if (res.networkType === 'none') {
            this.showOfflineMessage();
          }
        }
      });
    },

    showOfflineMessage() {
      uni.showToast({
        title: '当前处于离线状态',
        icon: 'none',
        duration: 3000
      });
    }
  }
};
```

**验收标准**:
- ✅ 捕获所有未处理的错误
- ✅ 显示友好的错误提示
- ✅ 网络错误自动重试（最多 3 次）
- ✅ 离线状态显示提示
- ✅ 错误日志保存到本地
- ✅ 崩溃后自动恢复

---

## ⏱️ 时间估算和里程碑

### 总体时间规划

| 阶段 | 时长 | 工作日 | 完成日期 |
|-----|------|--------|---------|
| Phase 1: 社交功能 UI | 40-50h | 5-6天 | Week 1 结束 |
| Phase 2: 知识库 & AI | 30-40h | 4-5天 | Week 2 中期 |
| Phase 3: 消息中心 | 15-20h | 2-3天 | Week 2 结束 |
| Phase 4: 认证优化 | 15-20h | 2-3天 | Week 3 中期 |
| Phase 5: 性能打磨 | 20-25h | 3-4天 | Week 4 结束 |
| **总计** | **120-155h** | **16-21天** | **3-4周** |

### 关键里程碑

#### Milestone 1: Week 1 结束
**日期**: Day 7
**成果**:
- ✅ 社交功能 UI 集成完成
- ✅ 好友列表可用
- ✅ 动态发布可用
- ✅ 私密消息可用
- **移动端完成度**: 15% → 40%

#### Milestone 2: Week 2 结束
**日期**: Day 14
**成果**:
- ✅ 知识库 100% 完成
- ✅ AI 功能真实化
- ✅ 消息中心完善
- **移动端完成度**: 40% → 55%

#### Milestone 3: Week 3 结束
**日期**: Day 21
**成果**:
- ✅ 认证体验优化完成
- ✅ 性能优化完成
- ✅ UI 打磨完成
- **移动端完成度**: 55% → 65%

#### Milestone 4: Week 4 结束（最终交付）
**日期**: Day 28
**成果**:
- ✅ 所有功能测试通过
- ✅ 文档完善
- ✅ 部署就绪
- **移动端完成度**: 65% → 70%

---

## 💰 资源需求

### 人力资源

**开发人员**: 1-2 名全栈开发者
- Vue 3 / uni-app 经验
- 移动端 UI/UX 经验
- 加密和安全知识

**测试人员**: 1 名（兼职）
- 负责功能测试
- 负责兼容性测试（iOS/Android/H5）

### 技术资源

**必需**:
- ✅ uni-app 开发环境
- ✅ HBuilderX IDE
- ✅ iOS/Android 真机测试设备
- ✅ LLM API 密钥（OpenAI / DeepSeek / 通义千问等）

**可选**:
- 云端 RAG 服务（或使用本地 transformers.js）
- 云存储服务（阿里云 OSS / 腾讯云 COS）
- APNs 推送证书（iOS 推送通知）

### 预算估算

| 项目 | 费用（USD/月） | 说明 |
|-----|---------------|------|
| LLM API 调用 | $50-100 | DeepSeek 较便宜 |
| 云存储 | $10-20 | 用于图片/文件存储 |
| 服务器（可选） | $20-50 | RAG 服务部署 |
| 推送服务（可选） | $10-30 | 极光推送/个推 |
| **总计** | **$90-200/月** | 取决于用户量 |

---

## ⚠️ 风险评估

### 高风险 (P0)

#### 风险 1: transformers.js 在 uni-app 环境中无法运行
**影响**: RAG 语义搜索功能无法实现
**概率**: 70%
**应对方案**:
- **Plan A**: 调用后端 ai-service 的 RAG API（推荐）
- **Plan B**: H5 使用 transformers.js，App 使用云端 API
- **Plan C**: 暂时使用关键词匹配，后续迁移

#### 风险 2: P2P 网络未实现，好友功能受限
**影响**: 无法实现真实的好友发现和消息传递
**概率**: 100%（已知问题）
**应对方案**:
- **Phase 1**: 仅实现本地数据展示和 UI 交互
- **Phase 2**: 使用中心化服务器中转（临时方案）
- **Phase 3**: 等待 P2P 网络实现后集成

### 中风险 (P1)

#### 风险 3: 生物识别在不同设备上兼容性问题
**影响**: 部分设备无法使用生物识别登录
**概率**: 40%
**应对方案**:
- 充分测试主流设备（iPhone, 华为, 小米, OPPO, vivo）
- 提供降级方案（PIN 码登录）
- 显示友好的不支持提示

#### 风险 4: LLM API 调用成本超预算
**影响**: 运营成本增加
**概率**: 30%
**应对方案**:
- 优先使用 DeepSeek（成本低）
- 实施调用频率限制
- 缓存常见查询结果
- 提供本地模式（不调用 API）

### 低风险 (P2)

#### 风险 5: 主题适配不完整
**影响**: 部分页面在深色模式下显示异常
**概率**: 20%
**应对方案**:
- 建立主题测试清单
- 逐页面检查和修复

#### 风险 6: 性能优化效果不明显
**影响**: 用户体验提升有限
**概率**: 15%
**应对方案**:
- 使用性能分析工具定位瓶颈
- 优先优化关键路径
- 逐步迭代优化

---

## ✅ 验收标准

### 功能验收

#### 1. 社交功能 (Phase 1)
- [ ] 好友列表正常显示（包含头像、昵称、DID）
- [ ] 支持添加好友（扫码/手动输入）
- [ ] 支持接受/拒绝好友请求
- [ ] 支持删除好友
- [ ] 动态列表正常显示
- [ ] 支持发布文本和图片动态
- [ ] 支持点赞/取消点赞
- [ ] 支持评论动态
- [ ] 消息列表正常显示
- [ ] 支持发送/接收文本消息
- [ ] 支持发送/接收图片消息
- [ ] 消息端到端加密生效

#### 2. 知识库功能 (Phase 2)
- [ ] 文件夹列表正常显示
- [ ] 支持创建/重命名/删除文件夹
- [ ] 支持移动知识条目到文件夹
- [ ] 知识关联可视化展示

#### 3. AI 功能 (Phase 2)
- [ ] 智能摘要返回真实结果
- [ ] 标签建议准确
- [ ] 内容扩展质量良好
- [ ] 内容润色效果明显
- [ ] RAG 语义搜索准确率 > 70%

#### 4. 消息中心 (Phase 3)
- [ ] 通知列表正常显示
- [ ] 支持按类型筛选通知
- [ ] 未读消息红点显示
- [ ] TabBar 显示未读消息数量
- [ ] 消息搜索功能正常

#### 5. 认证体验 (Phase 4)
- [ ] 生物识别登录正常（支持的设备）
- [ ] PIN 码输入体验流畅
- [ ] 错误时有震动反馈
- [ ] 安全设置页面功能完整

#### 6. 性能和 UI (Phase 5)
- [ ] 所有页面支持主题切换
- [ ] 页面切换流畅无卡顿
- [ ] 列表滚动流畅（60fps）
- [ ] 图片懒加载生效
- [ ] 错误提示友好
- [ ] 离线状态提示正常

### 质量验收

#### 性能指标
- [ ] 应用启动时间 < 2 秒
- [ ] 页面首屏加载 < 1 秒
- [ ] 列表滚动帧率 ≥ 55fps
- [ ] 内存占用稳定（无泄漏）
- [ ] 包体积 < 20MB

#### 兼容性
- [ ] iOS 12+ 正常运行
- [ ] Android 7.0+ 正常运行
- [ ] H5 在主流浏览器正常运行
- [ ] 屏幕适配正常（iPhone SE 到 iPad）

#### 安全性
- [ ] 端到端加密测试通过
- [ ] PIN 码加密存储
- [ ] 敏感数据不泄漏（日志中）
- [ ] HTTPS 通信

#### 用户体验
- [ ] 无明显 UI 错位
- [ ] 按钮点击有反馈
- [ ] 加载状态清晰
- [ ] 错误提示友好
- [ ] 操作流程合理（≤3步完成核心任务）

---

## 🔮 后续优化建议

### 短期优化 (1-2 个月)

#### 1. P2P 网络集成
**优先级**: P0
**工时**: 40-60 小时

**方案**:
- 集成 WebRTC 数据通道
- 使用 WebSocket 中继服务器
- 实现 DHT 节点发现
- 集成 Signal 协议加密

**预期成果**:
- 真正的点对点通信
- 离线消息中继
- 好友状态实时同步

#### 2. 项目管理模块实现
**优先级**: P1
**工时**: 60-80 小时

**功能清单**:
- 项目 CRUD
- 文件管理
- 项目 AI 助手
- 任务管理
- 协作功能

#### 3. 真实 RAG 系统
**优先级**: P1
**工时**: 30-40 小时

**方案**:
- 部署 Qdrant 向量数据库
- 集成 transformers.js（H5）
- 调用后端 embedding 服务（App）
- 实现混合检索（向量+关键词）

### 中期优化 (2-4 个月)

#### 4. 智能合约集成
**优先级**: P2
**工时**: 80-100 小时

**功能**:
- 以太坊钱包集成
- 托管合约部署
- 交易签名
- NFT 铸造

#### 5. IPFS 分布式存储
**优先级**: P2
**工时**: 40-50 小时

**功能**:
- IPFS 上传/下载
- 内容寻址
- Pin 服务集成

#### 6. Git 仓库同步
**优先级**: P2
**工时**: 50-60 小时

**功能**:
- Git Push/Pull
- 冲突解决 UI
- 版本历史查看

### 长期优化 (4-6 个月)

#### 7. 微信小程序版本
**优先级**: P3
**工时**: 100-120 小时

**限制**:
- 无法使用加密库（需要云端加密）
- 无法使用 WebRTC（需要中转）
- 包体积限制 2MB（需要分包）

#### 8. 多语言支持
**优先级**: P3
**工时**: 40-50 小时

**语言**:
- 英语
- 日语
- 韩语

#### 9. 插件系统
**优先级**: P3
**工时**: 60-80 小时

**功能**:
- 插件市场
- 自定义主题
- 第三方集成

---

## 📚 附录

### A. 技术栈清单

| 分类 | 技术 | 版本 | 用途 |
|-----|------|------|------|
| **框架** | uni-app | 3.0 | 跨平台开发 |
| | Vue | 3.4.21 | 前端框架 |
| | Vite | 5.2.8 | 构建工具 |
| **状态管理** | Pinia | 2.1.7 | 全局状态 |
| **数据库** | SQLite | - | H5/App 双模式 |
| **加密** | tweetnacl | 1.0.3 | Ed25519 + X25519 |
| | crypto-js | 4.2.0 | AES 加密 |
| | bs58 | 5.0.0 | Base58 编码 |
| **LLM** | 自定义 | - | 支持 10+ 提供商 |
| **样式** | SCSS | - | CSS 预处理 |

### B. 文件路径速查

| 功能模块 | 文件路径 |
|---------|---------|
| 好友管理 | `pages/social/friends/*.vue` |
| 动态发布 | `pages/social/posts/*.vue` |
| 私密消息 | `pages/social/friend-chat/*.vue` |
| 知识库 | `pages/knowledge/*.vue` |
| AI 对话 | `pages/ai/*.vue` |
| 认证 | `pages/auth/*.vue` |
| 设置 | `pages/settings/*.vue` |
| 数据库服务 | `services/database.js` |
| DID 服务 | `services/did.js` |
| 好友服务 | `services/friends.js` |
| 动态服务 | `services/posts.js` |
| 消息服务 | `services/messaging.js` |
| AI 服务 | `services/ai.js` |
| LLM 服务 | `services/llm.js` |
| RAG 服务 | `services/knowledge-rag.js` |
| 加密管理 | `services/encryption-manager.js` |

### C. 数据库表结构速查

| 表名 | 说明 | 关键字段 |
|-----|------|---------|
| `knowledge_items` | 知识条目 | id, title, content, folder_id |
| `tags` | 标签 | id, name, color |
| `folders` | 文件夹 | id, name, parent_id |
| `identities` | DID 身份 | id, did, public_key, private_key |
| `friendships` | 好友关系 | id, user_did, friend_did, status |
| `posts` | 动态 | id, author_did, content, visibility |
| `post_comments` | 评论 | id, post_id, author_did, content |
| `conversations` | 会话 | id, participant_did, last_message |
| `messages` | 消息 | id, sender_did, recipient_did, content |
| `ai_conversations` | AI 对话 | id, title, model, created_at |
| `notifications` | 通知 | id, type, title, message, read |

### D. API 端点清单（云端服务）

| 服务 | 端点 | 说明 |
|-----|------|------|
| **AI Service** | `POST /api/rag/search` | RAG 语义搜索 |
| | `POST /api/rag/embed` | 生成 Embedding |
| | `POST /api/chat/completions` | LLM 对话 |
| **Project Service** | `GET /api/projects` | 获取项目列表 |
| | `POST /api/projects` | 创建项目 |
| **WebDAV** | `PUT /{path}` | 上传文件 |
| | `GET /{path}` | 下载文件 |

### E. 常用命令速查

```bash
# 开发
cd mobile-app-uniapp
npm install
npm run dev:h5              # H5 开发
npm run dev:mp-weixin       # 微信小程序
npm run build:app-android   # 打包 Android
npm run build:app-ios       # 打包 iOS

# 测试
npm run test

# 代码检查
npm run lint

# 格式化
npm run format

# 清理
npm run clean
```

---

## 📝 变更记录

| 版本 | 日期 | 修改人 | 变更内容 |
|-----|------|--------|---------|
| v1.0 | 2025-12-31 | Claude Sonnet 4.5 | 初始版本 |

---

**文档所有者**: ChainlessChain 开发团队
**审核者**: 待定
**批准者**: 待定

**下一步行动**: 等待审核和批准后开始实施 Phase 1

---

🤖 **Generated with [Claude Code](https://claude.com/claude-code)**

**Co-Authored-By**: Claude Sonnet 4.5 <noreply@anthropic.com>
