# 内容推荐系统

> **Phase 48 | v1.1.0-alpha | 6 IPC 处理器 | 2 张新数据库表**

## 概述

内容推荐系统基于用户行为信号（阅读、点赞、收藏等）自动构建兴趣画像，所有推荐算法均在本地运行以保护隐私。采用内容相似度（TF-IDF）、协同过滤（P2P 匿名 + 差分隐私）和热度加权的混合推荐策略，每条推荐附带透明的理由说明。

## 核心特性

- 🎯 **用户兴趣画像**: 基于 6 种行为信号（阅读/点赞/收藏/分享/评论/跳过）自动构建兴趣模型
- 📊 **全本地推荐**: 所有推荐算法在本地运行，数据不上传，隐私完全可控
- 🔀 **混合推荐策略**: 内容相似度(TF-IDF) + 协同过滤(P2P匿名) + 热度加权，自适应权重
- 💡 **推荐透明化**: 每条推荐附带理由说明，用户可随时反馈和调整
- 🔒 **差分隐私**: P2P 协同过滤使用差分隐私技术，匿名交换兴趣数据

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              内容推荐系统                         │
├─────────────────────────────────────────────────┤
│  用户行为  →  兴趣画像器  →  兴趣模型           │
│                    ↓                             │
│  ┌─────────────────────────────────────────┐    │
│  │           本地推荐引擎                   │    │
│  │  ┌──────────┐ ┌──────┐ ┌────────────┐  │    │
│  │  │ 内容相似 │ │ 协同 │ │ 热度推荐   │  │    │
│  │  │ TF-IDF   │ │ 过滤 │ │ 时间衰减   │  │    │
│  │  └────┬─────┘ └──┬───┘ └─────┬──────┘  │    │
│  │       └──────────┼───────────┘          │    │
│  │                  ↓                      │    │
│  │         混合加权融合                     │    │
│  └──────────────────┬──────────────────────┘    │
│                     ↓                           │
│  推荐结果  ←  反馈学习  ←  用户反馈             │
├─────────────────────────────────────────────────┤
│  DB: user_interest_profiles | content_recs      │
└─────────────────────────────────────────────────┘
```

## 核心功能

### 1. 兴趣画像器 (Interest Profiler)

基于用户交互行为自动构建兴趣模型。

**行为信号**:

| 信号类型 | 权重 | 说明               |
| -------- | ---- | ------------------ |
| 阅读     | 1.0  | 打开内容并停留 >5s |
| 点赞     | 2.0  | 显式正反馈         |
| 收藏     | 3.0  | 强兴趣信号         |
| 分享     | 2.5  | 社交传播信号       |
| 评论     | 2.0  | 深度参与信号       |
| 跳过     | -0.5 | 负反馈信号         |

**使用示例**:

```javascript
// 记录用户行为
await window.electronAPI.invoke("recommendation:track-interaction", {
  contentId: "post-123",
  interactionType: "like",
  metadata: { duration: 30 },
});

// 获取兴趣画像
const profile = await window.electronAPI.invoke(
  "recommendation:get-interest-profile",
);

console.log(profile);
// {
//   interests: [
//     { topic: '技术', score: 0.92, confidence: 'high' },
//     { topic: 'AI', score: 0.85, confidence: 'high' },
//     { topic: 'Web3', score: 0.72, confidence: 'medium' },
//     { topic: '摄影', score: 0.45, confidence: 'low' }
//   ],
//   lastUpdated: 1709078400000,
//   totalInteractions: 256
// }

// 更新兴趣画像
await window.electronAPI.invoke("recommendation:update-profile");
```

**数据库结构**:

```sql
CREATE TABLE user_interest_profiles (
  id TEXT PRIMARY KEY,
  user_did TEXT NOT NULL,
  topic TEXT NOT NULL,
  score REAL DEFAULT 0,
  interaction_count INTEGER DEFAULT 0,
  last_interaction INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
```

---

### 2. 本地推荐器 (Local Recommender)

完全本地化的推荐引擎，支持多种推荐策略。

**推荐策略**:

1. **基于内容的推荐** (Content-Based)
   - TF-IDF 关键词匹配
   - 主题相似度计算
   - 作者相似度

2. **协同过滤** (Collaborative Filtering)
   - 基于相似用户的偏好
   - P2P 网络匿名兴趣交换

3. **热度推荐** (Trending)
   - 时间衰减的热度分数
   - 社区内趋势内容

4. **混合推荐** (Hybrid)
   - 多策略加权融合
   - 自适应权重调整

**使用示例**:

```javascript
// 获取个性化推荐
const recommendations = await window.electronAPI.invoke(
  "recommendation:get-recommendations",
  {
    limit: 20,
    strategy: "hybrid", // content/collaborative/trending/hybrid
  },
);

console.log(recommendations);
// [
//   {
//     contentId: 'post-456',
//     title: '深度学习在去中心化系统中的应用',
//     score: 0.95,
//     reason: '基于您对AI和Web3的兴趣',
//     strategy: 'content-based'
//   },
//   ...
// ]

// 获取相似内容推荐
const similar = await window.electronAPI.invoke(
  "recommendation:get-similar-content",
  {
    contentId: "post-123",
    limit: 10,
  },
);

// 刷新推荐列表
await window.electronAPI.invoke("recommendation:refresh");
```

**数据库结构**:

```sql
CREATE TABLE content_recommendations (
  id TEXT PRIMARY KEY,
  user_did TEXT NOT NULL,
  content_id TEXT NOT NULL,
  score REAL NOT NULL,
  strategy TEXT NOT NULL,
  reason TEXT,
  shown INTEGER DEFAULT 0,
  clicked INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

---

### 3. 推荐反馈

```javascript
// 对推荐结果提供反馈
await window.electronAPI.invoke("recommendation:feedback", {
  recommendationId: "rec-001",
  feedback: "relevant", // relevant/irrelevant/already-seen
});

// 标记不感兴趣
await window.electronAPI.invoke("recommendation:dismiss", {
  contentId: "post-789",
  reason: "not-interested",
});
```

---

## 前端集成

### Pinia Store

```typescript
import { useRecommendationStore } from "@/stores/recommendation";

const recommendation = useRecommendationStore();

// 获取推荐
await recommendation.fetchRecommendations();

// 访问推荐列表
console.log(recommendation.recommendations);

// 获取兴趣画像
await recommendation.fetchProfile();
console.log(recommendation.interests);
```

### 前端页面

**推荐内容页面** (`/recommendations`)

**功能模块**:

1. **个性化推荐流**
   - 无限滚动推荐列表
   - 推荐理由展示
   - 一键反馈

2. **兴趣画像**
   - 兴趣标签云
   - 兴趣分数趋势
   - 手动兴趣调整

3. **发现**
   - 热门内容
   - 社区趋势
   - 相似创作者

---

## 配置选项

```json
{
  "socialAI": {
    "recommendation": {
      "enabled": true,
      "strategy": "hybrid",
      "weights": {
        "contentBased": 0.4,
        "collaborative": 0.3,
        "trending": 0.3
      },
      "maxRecommendations": 50,
      "refreshInterval": 3600000,
      "minConfidence": 0.3,
      "decayFactor": 0.95
    }
  }
}
```

---

## 使用场景

### 场景 1: 新用户冷启动

```javascript
// 1. 用户注册后，设置初始兴趣
await window.electronAPI.invoke("recommendation:track-interaction", {
  contentId: "category-tech",
  interactionType: "like",
});

// 2. 基于初始兴趣获取推荐
const recs = await window.electronAPI.invoke(
  "recommendation:get-recommendations",
  {
    limit: 10,
    strategy: "trending", // 冷启动使用热度推荐
  },
);
```

### 场景 2: 持续个性化

```javascript
// 用户持续阅读内容，系统自动学习
// 推荐质量随时间不断提升

// 查看推荐效果指标
const metrics = await window.electronAPI.invoke("recommendation:get-metrics");
// {
//   clickThroughRate: 0.32,
//   relevanceScore: 0.78,
//   diversityScore: 0.65,
//   totalRecommendations: 1500
// }
```

---

## 隐私保护

1. **本地计算**: 所有推荐算法在本地运行，数据不上传
2. **匿名交换**: P2P 协同过滤使用差分隐私
3. **数据控制**: 用户可随时清除兴趣数据
4. **透明推荐**: 每条推荐都附带理由说明

---

## 性能指标

| 指标         | 目标   | 实际   |
| ------------ | ------ | ------ |
| 推荐生成延迟 | <200ms | ~150ms |
| 兴趣画像更新 | <100ms | ~70ms  |
| 相似内容计算 | <300ms | ~200ms |
| 推荐刷新     | <500ms | ~350ms |

---

## 配置参考

```javascript
// desktop-app-vue/src/main/social/content-recommendation.js
const DEFAULT_CONFIG = {
  // 推荐引擎
  strategy: "hybrid",               // 推荐策略: content | collaborative | trending | hybrid
  weights: {
    contentBased: 0.4,              // 内容相似度权重 (TF-IDF)
    collaborative: 0.3,             // 协同过滤权重 (P2P 匿名)
    trending: 0.3,                  // 热度推荐权重 (时间衰减)
  },
  maxRecommendations: 50,           // 每次最多推荐条数
  refreshInterval: 3600000,         // 推荐缓存刷新间隔 (ms)，默认 1 小时
  minConfidence: 0.3,               // 推荐最低置信度阈值 (0~1)
  decayFactor: 0.95,                // 兴趣衰减系数 (每次更新)

  // 兴趣画像
  interestProfile: {
    minInteractions: 5,             // 兴趣生效所需最低交互次数
    maxTopics: 50,                  // 兴趣画像最大主题数
    highConfidenceThreshold: 0.7,   // 高置信度阈值
    mediumConfidenceThreshold: 0.4, // 中置信度阈值
  },

  // 差分隐私 (P2P 协同过滤)
  privacy: {
    enabled: true,                  // 启用差分隐私
    epsilon: 1.0,                   // 隐私预算 (越小越安全，越大越准确)
    noiseScale: 0.1,                // 兴趣向量噪声幅度
  },
};
```

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `strategy` | `hybrid` | 推荐策略，`hybrid` 综合三种算法 |
| `weights.contentBased` | `0.4` | 内容相似度在混合策略中的权重 |
| `weights.collaborative` | `0.3` | 协同过滤权重，依赖 P2P 网络 |
| `weights.trending` | `0.3` | 热度推荐权重，适合冷启动 |
| `maxRecommendations` | `50` | 单次推荐上限，过大影响性能 |
| `refreshInterval` | `3600000` | 毫秒，推荐缓存有效期 |
| `minConfidence` | `0.3` | 低于此值的推荐被过滤 |
| `decayFactor` | `0.95` | 每次画像更新时旧兴趣的衰减系数 |
| `privacy.epsilon` | `1.0` | 差分隐私预算，建议范围 0.1~2.0 |

---

## 测试覆盖率

```
✅ content-recommendation.test.js        - 推荐引擎核心逻辑（混合策略、权重融合）
✅ interest-profiler.test.js             - 兴趣画像构建（6 种行为信号权重）
✅ local-recommender.test.js             - 本地推荐算法（TF-IDF / 协同过滤 / 热度）
✅ recommendation-feedback.test.js       - 推荐反馈与负样本学习
✅ stores/recommendation.test.ts         - Pinia Store 状态管理与 IPC 调用
```

---

## 故障排查

### 推荐结果为空或过少

- **冷启动问题**: 新用户交互数据不足时推荐质量较低，系统会自动切换到热度推荐策略
- **兴趣画像过期**: 长时间未使用后兴趣数据可能衰减过多，调用 `recommendation:update-profile` 刷新画像
- **内容库不足**: 推荐引擎需要足够的候选内容，确保社交网络中有活跃的内容发布

### 推荐内容不相关

```javascript
// 对不相关推荐提供负反馈，帮助系统学习
await window.electronAPI.invoke('recommendation:feedback', {
  recommendationId: 'rec-xxx',
  feedback: 'irrelevant'
});

// 手动调整兴趣画像，降低某个主题的权重
await window.electronAPI.invoke('recommendation:dismiss', {
  contentId: 'post-xxx',
  reason: 'not-interested'
});
```

### 推荐生成延迟过高

- 检查本地数据库大小，过多历史数据会影响 TF-IDF 计算速度
- 确认 `refreshInterval` 配置合理（默认 1 小时），避免过于频繁的全量刷新
- P2P 协同过滤依赖网络连接，离线时仅使用本地内容推荐策略

---

## 安全考虑

- **全本地计算**: 所有推荐算法在本地运行，用户行为数据不上传到任何外部服务器
- **差分隐私**: P2P 协同过滤使用差分隐私技术，交换的兴趣数据经过噪声处理，无法还原个人信息
- **数据可控**: 用户可随时清除兴趣画像和推荐历史数据
- **透明推荐**: 每条推荐附带理由说明，用户可了解推荐逻辑，避免"信息茧房"
- **行为数据隔离**: 用户行为记录仅存储在本地 SQLite 数据库中，受 SQLCipher 加密保护
- **最小数据收集**: 仅记录必要的行为信号（6 种交互类型），不追踪浏览器指纹等额外信息

---

## 使用示例

### 推荐系统配置与策略调整

```javascript
// 切换推荐策略为内容相似度优先
await window.electronAPI.invoke('recommendation:update-config', {
  strategy: 'hybrid',
  weights: { contentBased: 0.6, collaborative: 0.2, trending: 0.2 }
});

// 降低推荐最低置信度阈值（获取更多推荐结果）
await window.electronAPI.invoke('recommendation:update-config', {
  minConfidence: 0.2
});
```

### 相似内容搜索

```javascript
// 基于当前阅读内容查找相似文章
const similar = await window.electronAPI.invoke('recommendation:get-similar-content', {
  contentId: 'post-123',
  limit: 10
});
// 返回按相似度降序排列的内容列表，每条附带匹配分数和匹配原因

// 基于关键词搜索推荐候选内容
const results = await window.electronAPI.invoke('recommendation:get-recommendations', {
  limit: 20,
  strategy: 'content'  // 仅使用内容相似度策略
});
```

### 用户偏好学习与反馈

```javascript
// 批量记录用户行为（阅读 + 收藏）
await window.electronAPI.invoke('recommendation:track-interaction', {
  contentId: 'post-456', interactionType: 'read', metadata: { duration: 120 }
});
await window.electronAPI.invoke('recommendation:track-interaction', {
  contentId: 'post-456', interactionType: 'bookmark'
});

// 对不感兴趣的推荐提供负反馈（系统自动降权该主题）
await window.electronAPI.invoke('recommendation:dismiss', {
  contentId: 'post-789', reason: 'not-interested'
});

// 手动刷新兴趣画像，使最新行为数据立即生效
await window.electronAPI.invoke('recommendation:update-profile');
```

## 相关文档

- [Social AI + ActivityPub](/chainlesschain/social-ai)
- [去中心化社交](/chainlesschain/social)
- [Nostr 桥接](/chainlesschain/nostr-bridge)
- [产品路线图](/chainlesschain/product-roadmap)

## 关键文件

| 文件 | 说明 |
| --- | --- |
| `desktop-app-vue/src/main/social/content-recommendation.js` | 推荐引擎核心实现 |
| `desktop-app-vue/src/main/social/interest-profiler.js` | 兴趣画像构建器 |
| `desktop-app-vue/src/main/social/local-recommender.js` | 本地推荐算法（内容/协同/热度） |
| `desktop-app-vue/src/main/social/recommendation-feedback.js` | 推荐反馈与学习 |
| `desktop-app-vue/src/renderer/stores/recommendation.ts` | 推荐系统 Pinia Store |

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
