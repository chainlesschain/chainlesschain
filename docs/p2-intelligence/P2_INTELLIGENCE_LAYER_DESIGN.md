# P2 Intelligence Layer Design
# ML优化的技能-工具匹配与推荐系统

**Version**: v0.21.0
**Design Date**: 2026-01-02
**Status**: 🎯 Design Phase
**Type**: P2.5 Enhancement (Intelligence Layer)

---

## 📋 概述

在P2扩展优化（任务分解、工具组合、历史记忆）的基础上，添加**智能层**，使用机器学习优化技能-工具匹配，基于用户行为动态调整，并提供主动工具推荐。

### 核心目标

1. **智能匹配**: 使用ML替代规则引擎，提升意图→工具映射准确率
2. **自适应学习**: 根据用户使用模式动态调整系统行为
3. **主动推荐**: 预测用户需求，推荐最佳工具组合

---

## 🎯 三大核心功能

### 1. ML优化的技能-工具匹配系统

**当前问题**:
- 基于规则的意图识别，无法适应新场景
- 工具选择依赖硬编码逻辑，缺乏灵活性
- 无法学习用户个性化偏好

**ML解决方案**:

#### 模型架构

```
用户输入 → Embedding → ML分类器 → 工具概率分布 → Top-K工具
   ↓           ↓            ↓              ↓
文本预处理   向量化    意图分类      工具排序
```

**技术栈**:
- **Embedding**: Sentence-BERT (中文优化版) 或 LLM API
- **分类器**:
  - 轻量级: Logistic Regression / Naive Bayes (初期)
  - 中级: XGBoost / LightGBM (生产)
  - 高级: Fine-tuned Transformer (高级场景)
- **特征工程**:
  - 文本特征: TF-IDF, N-gram, Word Embeddings
  - 上下文特征: 历史工具使用、时间、场景类型
  - 用户特征: 技能水平、偏好模式、成功率

#### 训练数据

```javascript
{
  "input": "帮我生成一个登录页面",
  "context": {
    "previousTools": ["readFile", "analyzeCode"],
    "userLevel": "intermediate",
    "timestamp": "2026-01-02T10:30:00Z"
  },
  "label": {
    "primaryTool": "codeGeneration",
    "secondaryTools": ["fileWrite", "formatCode"],
    "confidence": 0.95
  },
  "outcome": {
    "success": true,
    "executionTime": 2500,
    "userFeedback": "positive"
  }
}
```

**数据来源**:
1. 历史执行记录 (`task_execution_history`)
2. 用户反馈 (隐式: 成功/失败, 显式: 点赞/修改)
3. 工具组合历史 (`tool_composition_history`)

---

### 2. 基于用户使用数据的动态调整

**核心思路**: 系统根据每个用户的使用模式自动优化

#### 用户画像建模

```javascript
class UserProfile {
  userId: string;

  // 技能水平评估
  skillLevel: {
    overall: 'beginner' | 'intermediate' | 'advanced',
    domains: {
      'code': 0.8,        // 编程能力
      'design': 0.5,      // 设计能力
      'data': 0.7,        // 数据分析
      'writing': 0.9      // 写作能力
    }
  };

  // 使用偏好
  preferences: {
    preferredTools: ['codeGeneration', 'fileWrite'],
    preferredWorkflow: 'sequential' | 'parallel',
    averageTaskComplexity: 0.6,
    responseTimeExpectation: 'fast' | 'balanced' | 'thorough'
  };

  // 历史统计
  statistics: {
    totalTasks: 500,
    successRate: 0.87,
    avgTaskDuration: 3500,
    mostUsedTools: [
      { tool: 'codeGeneration', count: 120, successRate: 0.92 },
      { tool: 'fileWrite', count: 95, successRate: 0.88 }
    ]
  };

  // 时间模式
  temporalPatterns: {
    activeHours: [9, 10, 11, 14, 15, 16],  // 活跃时段
    weekdayActivity: { Mon: 0.9, Tue: 0.8, /* ... */ },
    taskTypeByTime: {
      morning: ['email', 'planning'],
      afternoon: ['coding', 'analysis']
    }
  };
}
```

#### 动态调整策略

| 用户类型 | 调整策略 | 示例 |
|---------|---------|------|
| 新手用户 | 简化工具选择，提供详细引导 | 优先推荐单一工具，避免复杂组合 |
| 中级用户 | 平衡自动化与控制权 | 推荐工具组合，但保留自定义选项 |
| 高级用户 | 高度自动化，允许复杂流程 | 自动并行化，智能预测需求 |

**实时调整机制**:

```python
def adjust_system_for_user(user_profile, current_task):
    # 1. 动态调整复杂度阈值
    if user_profile.skillLevel.overall == 'advanced':
        complexity_threshold = 0.8  # 允许更复杂的分解
    else:
        complexity_threshold = 0.5

    # 2. 调整LLM模型选择
    if user_profile.preferences.responseTimeExpectation == 'fast':
        preferred_model = 'small'  # qwen2:1.5b
    else:
        preferred_model = 'balanced'  # qwen2:7b

    # 3. 个性化工具权重
    tool_scores = calculate_base_scores(current_task)
    for tool, score in tool_scores.items():
        if tool in user_profile.preferences.preferredTools:
            tool_scores[tool] *= 1.2  # 提升偏好工具权重

    return {
        'complexity_threshold': complexity_threshold,
        'model': preferred_model,
        'tool_scores': tool_scores
    }
```

---

### 3. 工具推荐系统

**目标**: 主动预测用户需求，推荐最佳工具或工具组合

#### 推荐算法

**协同过滤 (Collaborative Filtering)**

```
相似用户发现 → 工具使用模式提取 → 推荐生成
```

示例:
```javascript
// 发现相似用户
const similarUsers = findSimilarUsers(currentUser, {
  features: ['skillLevel', 'preferredTools', 'taskTypes'],
  method: 'cosine_similarity',
  topK: 50
});

// 提取工具使用模式
const toolPatterns = extractToolPatterns(similarUsers, {
  minSupport: 0.1,  // 至少10%用户使用
  minConfidence: 0.7  // 70%置信度
});

// 生成推荐
const recommendations = recommendTools(currentTask, toolPatterns, {
  filterUsed: true,  // 过滤已使用的
  maxRecommendations: 5
});
```

**基于内容的推荐 (Content-Based)**

```javascript
// 分析当前任务特征
const taskFeatures = extractFeatures(currentTask);

// 查找历史成功案例
const successfulCases = queryHistoryMemory({
  similarityThreshold: 0.8,
  minSuccessRate: 0.85,
  features: taskFeatures
});

// 提取工具组合
const recommendedComposition = extractToolComposition(successfulCases);
```

**混合推荐 (Hybrid)**

```python
def hybrid_recommend(user, task, context):
    # 1. 协同过滤得分
    cf_scores = collaborative_filtering(user, task)

    # 2. 基于内容得分
    cb_scores = content_based(task, context)

    # 3. 历史记忆得分
    hm_scores = history_memory_predict(task)

    # 4. 加权融合
    final_scores = (
        0.4 * cf_scores +
        0.4 * cb_scores +
        0.2 * hm_scores
    )

    # 5. 应用用户偏好
    final_scores = apply_user_preferences(final_scores, user)

    return top_k_tools(final_scores, k=5)
```

#### 推荐展示

**时机**:
1. **任务开始前**: "根据您的需求，我推荐使用以下工具..."
2. **执行中**: "您可能还需要这些工具来完成任务..."
3. **失败后**: "建议尝试使用XX工具代替..."

**格式**:
```javascript
{
  "recommendations": [
    {
      "tool": "codeGeneration",
      "confidence": 0.92,
      "reason": "85%相似任务使用此工具成功",
      "estimatedDuration": "2-3分钟",
      "alternatives": ["templateGeneration", "codeCompletion"]
    },
    {
      "tool": "formatCode",
      "confidence": 0.78,
      "reason": "您通常在代码生成后使用",
      "estimatedDuration": "10秒"
    }
  ],
  "composition": {
    "sequence": ["codeGeneration", "formatCode", "addTests"],
    "parallelizable": ["formatCode", "addTests"],
    "confidence": 0.85
  }
}
```

---

## 🏗️ 系统架构

### 模块结构

```
┌─────────────────────────────────────────────────────────┐
│          P2 Intelligence Layer (v0.21.0)                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ ML Matcher   │  │ User Profiler│  │ Recommender  │  │
│  │ (意图→工具)  │  │ (用户画像)   │  │ (工具推荐)   │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                  │          │
│         └─────────────────┼──────────────────┘          │
│                           │                             │
│  ┌────────────────────────┴────────────────────────┐    │
│  │       Data Collection & Learning Engine         │    │
│  │  (数据收集 + 模型训练 + 在线学习)                │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│              P2 Extended Modules (v0.20.0)              │
│   Task Decomposition | Tool Composition | History      │
├─────────────────────────────────────────────────────────┤
│              P2 Core Modules (v0.18.0)                  │
│   Intent Fusion | Knowledge Distillation | Streaming   │
└─────────────────────────────────────────────────────────┘
```

### 核心类设计

#### 1. MLToolMatcher - 机器学习工具匹配器

```javascript
class MLToolMatcher {
  constructor(config = {}) {
    this.config = {
      modelType: 'xgboost',        // 'logistic', 'xgboost', 'transformer'
      embeddingModel: 'sentence-bert',
      confidenceThreshold: 0.7,
      maxRecommendations: 5,
      enableOnlineLearning: true,
      ...config
    };

    this.model = null;
    this.embedder = null;
    this.featureExtractor = null;
    this.db = null;
  }

  async initialize() {
    // 加载预训练模型
    await this.loadModel();

    // 初始化特征提取器
    this.featureExtractor = new FeatureExtractor();

    // 如果没有预训练模型，从历史数据训练
    if (!this.model) {
      await this.trainFromHistory();
    }
  }

  async predictTools(userInput, context = {}) {
    // 1. 提取特征
    const features = await this.featureExtractor.extract(userInput, context);

    // 2. ML预测
    const predictions = await this.model.predict(features);

    // 3. 后处理（过滤、排序）
    const filteredTools = this.postProcess(predictions, context);

    // 4. 返回Top-K工具
    return filteredTools.slice(0, this.config.maxRecommendations);
  }

  async updateModel(feedback) {
    if (!this.config.enableOnlineLearning) return;

    // 在线学习：根据用户反馈更新模型
    await this.model.partialFit(feedback);
  }

  async trainFromHistory() {
    // 从数据库加载训练数据
    const trainingData = await this.loadTrainingData();

    // 训练模型
    await this.model.fit(trainingData);

    // 保存模型
    await this.saveModel();
  }
}
```

#### 2. UserProfileManager - 用户画像管理器

```javascript
class UserProfileManager {
  constructor(config = {}) {
    this.config = {
      updateInterval: 3600000,  // 1小时更新一次
      minDataPoints: 10,         // 最少10个数据点才建立画像
      enableTemporalAnalysis: true,
      ...config
    };

    this.db = null;
    this.profiles = new Map();  // userId -> UserProfile
    this.cache = new LRUCache({ max: 1000 });
  }

  async getProfile(userId) {
    // 1. 检查缓存
    if (this.cache.has(userId)) {
      return this.cache.get(userId);
    }

    // 2. 从数据库加载
    let profile = await this.loadProfileFromDB(userId);

    // 3. 如果不存在，创建新画像
    if (!profile) {
      profile = await this.buildNewProfile(userId);
    }

    // 4. 缓存并返回
    this.cache.set(userId, profile);
    return profile;
  }

  async updateProfile(userId, newData) {
    const profile = await this.getProfile(userId);

    // 增量更新统计信息
    this.updateStatistics(profile, newData);

    // 重新评估技能水平
    this.reassessSkillLevel(profile);

    // 更新偏好
    this.updatePreferences(profile, newData);

    // 保存到数据库
    await this.saveProfile(profile);

    // 更新缓存
    this.cache.set(userId, profile);
  }

  async buildNewProfile(userId) {
    // 从历史数据构建初始画像
    const history = await this.loadUserHistory(userId);

    return {
      userId,
      skillLevel: this.assessSkillLevel(history),
      preferences: this.extractPreferences(history),
      statistics: this.calculateStatistics(history),
      temporalPatterns: this.analyzeTemporalPatterns(history),
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}
```

#### 3. ToolRecommender - 工具推荐引擎

```javascript
class ToolRecommender {
  constructor(config = {}) {
    this.config = {
      algorithm: 'hybrid',  // 'collaborative', 'content', 'hybrid'
      topK: 5,
      minConfidence: 0.6,
      diversityWeight: 0.2,  // 推荐多样性权重
      ...config
    };

    this.mlMatcher = null;
    this.profileManager = null;
    this.historyMemory = null;
    this.db = null;
  }

  async recommend(userId, task, context = {}) {
    // 1. 获取用户画像
    const profile = await this.profileManager.getProfile(userId);

    // 2. 多策略推荐
    const cfScores = await this.collaborativeFiltering(profile, task);
    const cbScores = await this.contentBasedFiltering(task, context);
    const mlScores = await this.mlMatcher.predictTools(task.description, context);

    // 3. 融合得分
    const finalScores = this.fuseScores({
      collaborative: cfScores,
      contentBased: cbScores,
      machineLearning: mlScores
    }, profile);

    // 4. 应用多样性
    const diversified = this.applyDiversity(finalScores);

    // 5. 生成推荐解释
    const recommendations = this.generateExplanations(diversified, profile);

    return recommendations;
  }

  async collaborativeFiltering(profile, task) {
    // 查找相似用户
    const similarUsers = await this.findSimilarUsers(profile);

    // 提取他们的工具使用模式
    const patterns = await this.extractPatterns(similarUsers, task);

    // 计算推荐得分
    return this.calculateCFScores(patterns);
  }

  async contentBasedFiltering(task, context) {
    // 提取任务特征
    const taskFeatures = this.extractTaskFeatures(task);

    // 查找历史成功案例
    const successCases = await this.historyMemory.querySuccessful(taskFeatures);

    // 提取工具并计算相似度
    return this.calculateCBScores(successCases, taskFeatures);
  }

  generateExplanations(recommendations, profile) {
    return recommendations.map(rec => ({
      ...rec,
      reason: this.explainRecommendation(rec, profile),
      estimatedDuration: this.estimateDuration(rec, profile),
      alternatives: this.findAlternatives(rec)
    }));
  }
}
```

---

## 📊 数据库扩展

### 新增表

#### 1. `user_profiles` - 用户画像表

```sql
CREATE TABLE user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,

  -- 技能水平
  overall_skill_level TEXT NOT NULL,  -- beginner/intermediate/advanced
  domain_skills TEXT,                 -- JSON: {code: 0.8, design: 0.5, ...}

  -- 偏好设置
  preferred_tools TEXT,               -- JSON: ["tool1", "tool2"]
  preferred_workflow TEXT,            -- sequential/parallel
  response_expectation TEXT,          -- fast/balanced/thorough

  -- 统计信息
  total_tasks INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0,
  avg_task_duration INTEGER,

  -- 时间模式
  active_hours TEXT,                  -- JSON: [9, 10, 11, ...]
  temporal_patterns TEXT,             -- JSON: 复杂时间模式

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);
CREATE INDEX idx_user_profiles_skill_level ON user_profiles(overall_skill_level);
```

#### 2. `tool_usage_events` - 工具使用事件表

```sql
CREATE TABLE tool_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,

  tool_name TEXT NOT NULL,
  task_type TEXT,
  task_context TEXT,                  -- JSON: 任务上下文

  execution_time INTEGER,             -- 执行耗时(ms)
  success INTEGER NOT NULL,           -- 0=失败, 1=成功

  user_feedback TEXT,                 -- positive/negative/neutral
  explicit_rating INTEGER,            -- 1-5星评分(可选)

  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tool_usage_user ON tool_usage_events(user_id);
CREATE INDEX idx_tool_usage_tool ON tool_usage_events(tool_name);
CREATE INDEX idx_tool_usage_timestamp ON tool_usage_events(timestamp);
```

#### 3. `tool_recommendations` - 推荐记录表

```sql
CREATE TABLE tool_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,

  task_description TEXT NOT NULL,
  recommended_tools TEXT NOT NULL,    -- JSON: 推荐的工具列表
  algorithm_used TEXT,                -- collaborative/content/hybrid

  user_action TEXT,                   -- accepted/rejected/modified/ignored
  actual_tools_used TEXT,             -- JSON: 实际使用的工具

  recommendation_quality REAL,        -- 推荐质量评分(0-1)

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tool_rec_user ON tool_recommendations(user_id);
CREATE INDEX idx_tool_rec_created ON tool_recommendations(created_at);
```

#### 4. `ml_model_metadata` - 模型元数据表

```sql
CREATE TABLE ml_model_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_name TEXT NOT NULL UNIQUE,
  model_type TEXT NOT NULL,           -- xgboost/logistic/transformer

  version TEXT NOT NULL,
  training_data_size INTEGER,
  training_date DATETIME,

  performance_metrics TEXT,           -- JSON: {accuracy: 0.92, f1: 0.89, ...}

  is_active INTEGER DEFAULT 0,        -- 当前是否在使用
  model_path TEXT,                    -- 模型文件路径

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🚀 实施路线图

### Phase 1: 数据收集基础设施 (Week 1)

**目标**: 建立用户行为数据收集机制

- [ ] 创建数据库表 (user_profiles, tool_usage_events, etc.)
- [ ] 实现 DataCollector 模块
- [ ] 添加事件埋点到现有工具调用
- [ ] 建立数据清洗与预处理管道

**交付物**:
- `data-collector.js`
- `run-migration-intelligence-layer.js`
- 数据收集率 > 95%

---

### Phase 2: 用户画像系统 (Week 1-2)

**目标**: 建立用户画像自动生成和更新机制

- [ ] 实现 UserProfileManager
- [ ] 技能水平评估算法
- [ ] 偏好提取逻辑
- [ ] 时间模式分析

**交付物**:
- `user-profile-manager.js`
- 画像覆盖率 > 80%活跃用户

---

### Phase 3: ML工具匹配器 (Week 2-3)

**目标**: 训练并部署ML模型进行工具匹配

- [ ] 特征工程 (文本 + 上下文 + 用户特征)
- [ ] 模型选型与训练 (XGBoost baseline)
- [ ] 在线推理集成
- [ ] A/B测试框架

**交付物**:
- `ml-tool-matcher.js`
- `feature-extractor.js`
- 准确率 > 85% (vs 规则引擎 70%)

---

### Phase 4: 推荐引擎 (Week 3-4)

**目标**: 实现多策略工具推荐系统

- [ ] 协同过滤算法
- [ ] 基于内容推荐
- [ ] 混合推荐融合
- [ ] 推荐解释生成

**交付物**:
- `tool-recommender.js`
- 推荐接受率 > 60%

---

### Phase 5: 集成与测试 (Week 4)

**目标**: 集成到AIEngineManagerP2并验证效果

- [ ] 集成到P2管理器
- [ ] 端到端测试
- [ ] 性能基准测试
- [ ] 用户反馈收集

**交付物**:
- 完整集成测试套件
- 性能报告

---

## 📈 成功指标

### 技术指标

| 指标 | 基线 | 目标 | 测量方式 |
|------|------|------|---------|
| 工具匹配准确率 | 70% (规则) | >85% | 用户实际使用 vs 推荐 |
| 推荐接受率 | N/A | >60% | 用户点击/使用推荐工具的比例 |
| 任务成功率 | 75% | >90% | 使用推荐工具的任务成功率 |
| 响应延迟 | +200ms | <50ms | ML推理额外延迟 |

### 业务指标

| 指标 | 目标 | 说明 |
|------|------|------|
| 用户满意度 | +15% | 通过用户反馈评分 |
| 工具发现率 | +30% | 用户使用新工具的比例 |
| 任务完成时间 | -20% | 通过智能推荐减少试错 |

---

## 🔧 技术栈

### 机器学习

- **训练**: Python (scikit-learn, XGBoost, PyTorch)
- **推理**:
  - Node.js (ONNX Runtime) - 轻量级模型
  - Python服务 (FastAPI) - 重型模型
- **特征存储**: Redis (实时特征) + SQLite (持久化)

### 数据处理

- **ETL**: Node.js streams
- **分析**: SQL (聚合) + JavaScript (复杂逻辑)
- **缓存**: LRU Cache (内存) + Redis (分布式)

---

## ⚠️ 风险与挑战

### 1. 冷启动问题

**问题**: 新用户没有历史数据，无法建立画像

**解决方案**:
- 使用全局模型作为fallback
- 引导式问卷快速建立初始画像
- 借鉴相似用户群体数据

### 2. 模型漂移

**问题**: 用户行为随时间变化，模型失效

**解决方案**:
- 在线学习持续更新
- 定期重训练（每月）
- 监控模型性能指标

### 3. 隐私与数据安全

**问题**: 用户行为数据敏感

**解决方案**:
- 本地化处理（SQLite）
- 匿名化用户ID
- 提供数据删除选项

### 4. 计算资源

**问题**: ML推理可能增加延迟

**解决方案**:
- 使用轻量级模型 (XGBoost)
- 预计算特征 (embedding缓存)
- 异步推荐（不阻塞主流程）

---

## 🎯 MVP范围 (Minimum Viable Product)

**优先实现**:

1. ✅ 数据收集基础设施
2. ✅ 简单用户画像 (统计型)
3. ✅ Logistic Regression 工具匹配器
4. ✅ 基于内容的推荐
5. ✅ 集成到AIEngineManagerP2

**后续迭代**:

- 协同过滤推荐
- 复杂ML模型 (XGBoost, Transformers)
- 自动特征工程
- 多臂老虎机 (MAB) 探索-利用平衡

---

## 📚 参考文献

1. **推荐系统**:
   - "Recommender Systems Handbook" (Ricci et al.)
   - Netflix 推荐算法论文

2. **用户画像**:
   - "User Modeling in Adaptive Systems" (Brusilovsky)
   - LinkedIn 技能建模

3. **机器学习**:
   - XGBoost: "XGBoost: A Scalable Tree Boosting System"
   - Sentence-BERT: "Sentence-BERT: Sentence Embeddings using Siamese BERT"

---

**设计负责人**: Claude Code (Sonnet 4.5)
**设计日期**: 2026-01-02
**状态**: 🎯 Ready for Implementation

---

*下一步: 开始Phase 1 - 数据收集基础设施实施*
