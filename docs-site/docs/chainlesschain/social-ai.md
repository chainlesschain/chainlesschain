# Social AI + ActivityPub 集成

> **Phase 42 | v1.1.0-alpha | 18 IPC 处理器 | 4 张新数据库表**

## 概述

Phase 42 为 ChainlessChain 引入了智能社交分析和 ActivityPub 联邦宇宙集成,将去中心化社交能力扩展到整个 Fediverse (Mastodon、Pleroma 等平台),同时提供 AI 驱动的社交洞察。

**核心目标**:
- 🧠 **AI 社交分析**: 主题提取、情感分析、社交图谱分析
- 🌐 **ActivityPub 集成**: 与 Mastodon 等平台互联互通
- 🤖 **AI 社交助手**: 智能回复生成、内容总结、话题推荐

---

## 核心功能

### 1. 主题分析器 (Topic Analyzer)

使用 NLP 技术自动分析社交内容,提取主题和情感。

**功能特性**:
- **TF-IDF 关键词提取**: 自动提取 Top-K 关键词
- **情感倾向分析**: 正面/负面/中性情感识别
- **9 个预定义分类**: 技术、生活、新闻、娱乐、教育、健康、财经、旅游、其他
- **相似度匹配**: 基于余弦相似度查找相关内容

**使用示例**:

```javascript
// 分析帖子内容
const analysis = await window.electronAPI.invoke('social:analyze-topic', {
  text: "刚刚完成了一个基于 AI 的去中心化社交平台..."
})

console.log(analysis)
// {
//   topics: ['技术', 'AI', '去中心化'],
//   keywords: ['AI', '去中心化', '社交平台', 'Web3'],
//   sentiment: 'positive',
//   sentiment_score: 0.85,
//   category: '技术'
// }
```

**应用场景**:
- 📊 **内容分类**: 自动为帖子添加分类标签
- 🔍 **智能搜索**: 基于主题和情感搜索内容
- 📈 **趋势分析**: 发现热门话题和趋势
- 🎯 **个性化推荐**: 基于兴趣推荐内容

---

### 2. 社交图谱分析 (Social Graph)

构建和分析用户社交关系网络,发现影响力用户和社区结构。

**4 种中心性分析**:

1. **度中心性 (Degree Centrality)**
   - 衡量节点的直接连接数
   - 识别连接最多的用户

2. **接近中心性 (Closeness Centrality)**
   - 衡量到其他节点的平均距离
   - 识别信息传播最快的用户

3. **中介中心性 (Betweenness Centrality)**
   - 衡量节点在路径上的重要性
   - 识别"桥梁"用户

4. **特征向量中心性 (Eigenvector Centrality)**
   - 衡量连接的质量(连接重要节点的节点更重要)
   - 识别真正有影响力的用户

**社区发现**:
- 使用 **Louvain 算法**自动检测社区
- 支持自定义最小社区规模
- 可视化社区结构

**使用示例**:

```javascript
// 添加关注关系
await window.electronAPI.invoke('social:add-graph-edge', {
  sourceDID: 'did:chainless:abc123',
  targetDID: 'did:chainless:def456',
  edgeType: 'follows',
  weight: 1.0
})

// 计算影响力
const influence = await window.electronAPI.invoke('social:calculate-influence', {
  did: 'did:chainless:abc123'
})
// { score: 0.85, rank: 15, community: 'tech-enthusiasts' }

// 发现社区
const communities = await window.electronAPI.invoke('social:detect-communities', {
  minSize: 3
})
```

**数据库结构**:

```sql
CREATE TABLE social_graph_edges (
  source_did TEXT NOT NULL,
  target_did TEXT NOT NULL,
  edge_type TEXT NOT NULL,  -- follows/mentions/replies/collaborates
  weight REAL DEFAULT 1.0,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
```

---

### 3. ActivityPub 桥接 (ActivityPub Bridge)

实现 W3C ActivityPub S2S (Server-to-Server) 协议,与 Fediverse 互联互通。

**支持的 Fediverse 平台**:
- 🐘 **Mastodon** - 最流行的去中心化微博
- 🦀 **Pleroma** - 轻量级 Fediverse 平台
- 🦢 **Misskey** - 日本流行的去中心化社交网络
- 其他兼容 ActivityPub 的平台

**核心概念**:

#### Actor (角色)
每个 ChainlessChain DID 可以映射为一个 ActivityPub Actor:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Person",
  "id": "https://chainlesschain.local/users/alice",
  "inbox": "https://chainlesschain.local/users/alice/inbox",
  "outbox": "https://chainlesschain.local/users/alice/outbox",
  "preferredUsername": "alice",
  "name": "Alice Smith",
  "summary": "AI enthusiast and developer",
  "publicKey": {
    "id": "https://chainlesschain.local/users/alice#main-key",
    "owner": "https://chainlesschain.local/users/alice",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
  }
}
```

#### Activity (活动)
支持的 Activity 类型:
- **Follow** - 关注
- **Like** - 点赞
- **Announce** - 转发
- **Create** - 创建内容
- **Update** - 更新内容
- **Delete** - 删除内容

**使用示例**:

```javascript
// 创建 Actor
const actor = await window.electronAPI.invoke('social:ap-create-actor', {
  did: 'did:chainless:abc123',
  displayName: 'Alice',
  summary: 'AI enthusiast'
})

// 关注 Mastodon 用户
await window.electronAPI.invoke('social:ap-follow', {
  localActorURI: actor.uri,
  remoteActorURI: 'https://mastodon.social/users/bob'
})

// 发布内容到 Fediverse
await window.electronAPI.invoke('social:ap-publish-local-content', {
  contentId: 'post-123',
  actorURI: actor.uri
})
```

**WebFinger 用户发现**:

支持 RFC 7033 WebFinger 协议,通过 `acct:user@domain` 格式查找用户:

```javascript
// 查找用户
const actorInfo = await window.electronAPI.invoke('social:ap-discover-actor', {
  username: 'bob',
  domain: 'mastodon.social'
})
// 返回: { actorURI: 'https://mastodon.social/users/bob', ... }
```

---

### 4. AI 社交助手 (AI Social Assistant)

基于 LLM 的智能社交助手,提供回复生成、内容总结、话题推荐等功能。

**3 种回复风格**:

1. **简洁 (concise)** - 1-2 句话,直击要点
2. **详细 (detailed)** - 3-5 句话,包含解释和背景
3. **幽默 (humorous)** - 加入幽默元素,更有趣

**使用示例**:

```javascript
// 生成回复
const reply = await window.electronAPI.invoke('social:ai-generate-reply', {
  postContent: "刚刚发布了新的开源项目!",
  context: "这是一个关于去中心化的技术讨论",
  style: 'humorous'
})

console.log(reply.text)
// "恭喜!🎉 去中心化的世界又多了一位贡献者,期待看到项目起飞!"

// 内容总结
const summary = await window.electronAPI.invoke('social:ai-summarize-content', {
  text: longArticleText,
  maxLength: 200
})

// 话题推荐
const topics = await window.electronAPI.invoke('social:ai-recommend-topics', {
  userDID: 'did:chainless:abc123',
  limit: 5
})
// ['AI', 'Web3', '去中心化', 'Rust', 'TypeScript']
```

---

## 前端集成

### Pinia Store

```typescript
import { useSocialAIStore } from '@/stores/socialAI'

const socialAI = useSocialAIStore()

// 分析内容
await socialAI.analyzeContent(text)

// 构建社交图谱
await socialAI.buildSocialGraph(myDID)

// 发布到 Fediverse
await socialAI.publishToFediverse(postId, actorURI)
```

### 前端页面

#### 社交洞察页面 (`/social-insights`)

**功能**:
- 📊 主题分析可视化(词云图/分类饼图)
- 🕸️ 社交图谱展示(力导向图)
- 🏆 影响力排行榜
- 📈 情感趋势分析

#### ActivityPub 桥接页面 (`/activitypub-bridge`)

**功能**:
- 👤 Actor 管理(创建/编辑)
- 📝 内容发布到 Fediverse
- 📥 Inbox/Outbox 查看
- 👥 关注者管理
- 📜 同步日志查看

---

## 配置选项

在 `~/.chainlesschain/config.json` 中配置:

```json
{
  "socialAI": {
    "enabled": true,
    "topicAnalysis": {
      "minKeywords": 5,
      "maxKeywords": 20,
      "sentimentThreshold": 0.3
    },
    "socialGraph": {
      "maxHops": 3,
      "minCommunitySize": 3,
      "edgeWeightDecay": 0.9
    }
  },
  "activitypub": {
    "instanceName": "ChainlessChain Node",
    "instanceDomain": "localhost:9000",
    "instanceDescription": "Decentralized Personal AI Assistant",
    "adminEmail": "admin@localhost"
  }
}
```

---

## 使用场景

### 场景 1: 发现热门话题

```javascript
// 1. 获取最近的主题统计
const stats = await window.electronAPI.invoke('social:get-topic-stats', {
  timeRange: '7d'
})

// 2. 显示 Top 10 话题
stats.topTopics.forEach(topic => {
  console.log(`${topic.name}: ${topic.count} 次提及`)
})
```

### 场景 2: 构建影响力网络

```javascript
// 1. 构建社交图谱
await socialAI.buildSocialGraph(myDID)

// 2. 识别关键意见领袖 (KOL)
const influencers = socialAI.getInfluentialUsers(10)

// 3. 发现我的社区
const myCommunity = await window.electronAPI.invoke('social:detect-communities', {
  minSize: 3
})
```

### 场景 3: 与 Mastodon 互动

```javascript
// 1. 创建 Actor
const actor = await window.electronAPI.invoke('social:ap-create-actor', {
  did: myDID,
  displayName: '张三',
  summary: 'Web3 开发者'
})

// 2. 关注 Mastodon 用户
await window.electronAPI.invoke('social:ap-follow', {
  localActorURI: actor.uri,
  remoteActorURI: 'https://mastodon.social/users/alice'
})

// 3. 发布本地内容到 Mastodon
await window.electronAPI.invoke('social:ap-publish-local-content', {
  contentId: myPostId,
  actorURI: actor.uri
})

// 4. 同步远程内容到本地
await window.electronAPI.invoke('social:ap-import-remote-content', {
  activityURI: 'https://mastodon.social/users/alice/statuses/123'
})
```

---

## 安全考虑

### HTTP 签名验证

所有 ActivityPub S2S 通信使用 HTTP 签名:

```
Signature: keyId="https://chainlesschain.local/users/alice#main-key",
  algorithm="rsa-sha256",
  headers="(request-target) host date digest",
  signature="..."
```

### 内容过滤

- 自动过滤恶意内容和垃圾信息
- 支持自定义过滤规则
- 实时威胁检测

### 隐私保护

- 用户可选择不公开社交图谱数据
- 支持匿名 Actor
- Inbox/Outbox 访问控制

### 速率限制

- API 调用限制: 100 req/min
- ActivityPub 请求限制: 50 req/min
- 防止滥用和 DoS 攻击

---

## 性能指标

| 指标 | 目标 | 实际 |
|------|------|------|
| 主题分析延迟 | <100ms | ~80ms |
| 图谱中心性计算 | <200ms | ~150ms |
| ActivityPub 发布延迟 | <500ms | ~400ms |
| WebFinger 解析延迟 | <300ms | ~250ms |
| 数据库查询延迟 | <50ms | ~30ms |

---

## 未来扩展

- [ ] **ML 主题分类**: 使用深度学习提升分类准确率
- [ ] **实时图谱更新**: WebSocket 推送图谱变化
- [ ] **多语言支持**: 支持中文/英文/日文主题分析
- [ ] **ActivityPub C2S**: 支持客户端到服务器协议
- [ ] **Fediverse 搜索**: 跨实例内容搜索
- [ ] **图谱可视化增强**: 3D 可视化,时间轴动画

---

## 相关文档

- [去中心化社交基础](/chainlesschain/social)
- [AI 模型配置](/chainlesschain/ai-models)
- [权限管理](/chainlesschain/permissions)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
