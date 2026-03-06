# 内容推荐系统

> **Phase 48 | v1.1.0-alpha | 6 IPC 处理器 | 2 张新数据库表**

## 概述

Phase 48 为 ChainlessChain 社交系统引入本地化内容推荐引擎，基于用户兴趣画像和协同过滤提供个性化内容推荐，所有计算在本地完成，保护用户隐私。

**核心目标**:

- 🎯 **兴趣画像**: 基于阅读行为自动构建用户兴趣模型
- 📊 **本地推荐**: 全部推荐计算在本地完成，无需云端
- 🔀 **混合策略**: 内容相似度 + 协同过滤 + 热度加权
- 🔒 **隐私优先**: 兴趣数据不出设备

---

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

## 相关文档

- [Social AI + ActivityPub](/chainlesschain/social-ai)
- [去中心化社交](/chainlesschain/social)
- [Nostr 桥接](/chainlesschain/nostr-bridge)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
