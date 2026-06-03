# 火山引擎豆包集成 - 快速开始指南

## 📚 文档导航

本次为 ChainlessChain 项目整理了火山引擎豆包的完整集成方案，包含以下文档：

| 文档 | 说明 | 路径 |
|------|------|------|
| **集成方案** | 工具调用（联网搜索、图像理解、Function Calling）完整实现方案 | [VOLCENGINE_TOOLS_INTEGRATION.md](./VOLCENGINE_TOOLS_INTEGRATION.md) |
| **模型列表** | 30+ 模型详细信息和智能选择器 | [desktop-app-vue/src/main/llm/volcengine-models.js](./desktop-app-vue/src/main/llm/volcengine-models.js) |
| **使用示例** | 12个实际场景的智能模型选择示例 | [desktop-app-vue/src/main/llm/volcengine-model-selector-examples.js](./desktop-app-vue/src/main/llm/volcengine-model-selector-examples.js) |
| **快速开始** | 本文档 | [VOLCENGINE_QUICK_START.md](./VOLCENGINE_QUICK_START.md) |

## 🎯 核心亮点

### 1️⃣ 完整模型生态（30+ 模型）

火山引擎豆包提供业界最全的专业模型：

```
文本生成模型（7个）
├── doubao-seed-1.6          ⭐ 256K上下文 + 深度思考
├── doubao-seed-1.6-thinking  深度推理专用
├── doubao-seed-1.6-flash     快速响应（延迟更低）
└── doubao-seed-1.6-lite      成本优化（最便宜）

视觉理解模型（5个）
├── doubao-seed-1.6-vision   ⭐ 256K + 图像/视频 + GUI Agent
├── doubao-1.5-vision-pro     专业视觉理解
└── doubao-1.5-vision-lite    轻量视觉（成本优化）

图像生成模型（4个）
├── doubao-seedream-4.5      ⭐ 最新图像生成
├── doubao-seedream-4.0       上一代图像生成
└── doubao-seededit-3.0-i2i   图像编辑（背景移除、光线调整）

视频生成模型（4个）
├── doubao-seedance-1.5-pro  ⭐ 首尾帧控制
├── doubao-pixeldance         高动态视频（复杂动作）
└── doubao-seedance-1.0-lite  轻量视频（成本优化）

向量嵌入模型（3个）
├── doubao-embedding-large   ⭐ 2048维（高精度）
├── doubao-embedding          1024维（标准）
└── doubao-embedding-vision   图像向量化

专用模型（4个）
├── doubao-seed-translation   翻译专用
├── doubao-seed3d-1.0         3D模型生成
├── doubao-seed-1.6-code      代码生成
└── doubao-1.5-ui-tars        GUI自动化
```

### 2️⃣ 智能模型选择器

无需手动选择模型，系统根据任务自动推荐最优方案：

```javascript
const { getModelSelector } = require('./llm/volcengine-models');
const selector = getModelSelector();

// 只需描述场景，自动选择模型
const model = selector.selectByScenario({
  hasImage: true,              // 有图片
  needsThinking: true,         // 需要深度思考
  userBudget: 'medium',        // 预算等级
});

console.log(model.name);       // doubao-seed-1.6-vision
console.log(model.pricing);    // ¥2.6/百万tokens
```

### 3️⃣ 工具调用能力

火山引擎提供 5 大工具调用功能，可显著增强 ChainlessChain 的 AI 能力：

| 工具 | 功能 | 应用场景 |
|------|------|---------|
| **联网搜索** | 实时信息检索 | 获取最新新闻、天气、股票、技术文档 |
| **图像处理** | 图像语义理解 | 补充OCR，理解图片内容、场景、物体 |
| **知识库搜索** | 私域知识库 | 云端知识库备份、团队协作 |
| **Function Calling** | 函数调用 | AI助手自动执行任务（创建笔记、发消息） |
| **MCP** | 标准化协议 | 第三方工具集成、企业级部署 |

## 🚀 5分钟快速集成

### Step 1: 配置 API Key

在桌面应用设置中配置火山引擎 API Key：

```
设置 -> LLM 配置 -> 火山引擎
├── API Key: [你的API Key]
├── Base URL: https://ark.cn-beijing.volces.com/api/v3
└── Model: doubao-seed-1.6 （默认）
```

### Step 2: 运行模型选择器示例

```bash
# 查看所有场景的智能选择结果
cd desktop-app-vue
node src/main/llm/volcengine-model-selector-examples.js
```

输出示例：

```
=== 场景 1: AI对话（低成本）===
选择: 豆包 Seed 1.6 轻量版
价格: ¥0.3/百万tokens

=== 场景 2: 图像理解 + 深度思考 ===
选择: 豆包 Seed 1.6 视觉版
能力: vision, deep_thinking, gui_agent, function_calling
成本: ¥2.6/百万tokens + ¥0.01/图

=== 场景 3: 视频生成（专业）===
选择: 豆包 Seedance 1.5 Pro
价格: ¥0.3/秒（5秒视频 = ¥1.5）
```

### Step 3: 在代码中使用智能选择器

#### 示例 1: AI 聊天（自动选择模型）

```javascript
const { getModelSelector } = require('./llm/volcengine-models');
const { getLLMManager } = require('./llm/llm-manager');

// 1. 根据场景智能选择模型
const selector = getModelSelector();
const model = selector.selectByScenario({
  needsFunctionCalling: true,   // 需要调用函数
  textLength: 50000,            // 长对话历史
  userBudget: 'medium',         // 中等预算
});

console.log('智能选择:', model.name);  // doubao-seed-1.6

// 2. 使用选中的模型进行对话
const llmManager = getLLMManager({
  provider: 'volcengine',
  model: model.id,
  apiKey: 'your-api-key',
});

await llmManager.initialize();
const result = await llmManager.chat([
  { role: 'user', content: '请帮我总结今天的新闻' }
]);
```

#### 示例 2: 图像理解（自动选择视觉模型）

```javascript
// 场景：分析用户上传的图片
const model = selector.selectByScenario({
  hasImage: true,
  needsThinking: true,          // 需要深度理解
  userBudget: 'high',
});

console.log('选择:', model.name);  // doubao-seed-1.6-vision

// 使用视觉模型
const result = await llmManager.chatWithMessages([
  {
    role: 'user',
    content: [
      { type: 'text', text: '这张图片中有什么？' },
      { type: 'image_url', image_url: { url: 'file://path/to/image.jpg' } }
    ]
  }
]);
```

#### 示例 3: 知识库向量化（自动选择嵌入模型）

```javascript
// 场景：构建知识库（需要向量化100万条文档）
const model = selector.selectByScenario({
  needsEmbedding: true,
  userBudget: 'medium',         // 大规模使用，成本敏感
});

console.log('选择:', model.name);          // doubao-embedding-large
console.log('向量维度:', model.dimensions); // 2048
console.log('价格:', model.pricing.input);  // ¥0.2/百万tokens

// 估算成本
const cost = selector.estimateCost(
  model.id,
  1000000,  // 100万tokens（约50万字）
  0,
  0
);
console.log('预估成本:', `¥${cost}`);  // ¥0.2
```

#### 示例 4: 视频生成（自动选择生成模型）

```javascript
// 场景：生成营销短视频（5秒）
const model = selector.selectByScenario({
  needsVideoGeneration: true,
  userBudget: 'high',
});

console.log('选择:', model.name);  // doubao-seedance-1.5-pro
console.log('能力:', model.description);
console.log('价格:', `¥${model.pricing.perSecond}/秒`);

// 生成5秒视频的成本
const cost = model.pricing.perSecond * 5;
console.log('5秒视频成本:', `¥${cost}`);  // ¥1.5
```

## 💡 实际应用场景

### 场景 1: 增强知识库问答

**当前实现**：本地 ChromaDB + Ollama

**增强方案**：本地 + 云端混合检索

```javascript
// 混合检索：本地快速检索 + 云端补充
class HybridRAG {
  async search(query) {
    // 1. 本地检索（速度快）
    const localResults = await this.chromaDB.search(query);

    // 2. 如果本地结果不足，调用火山引擎知识库搜索
    if (localResults.length < 3 || localResults[0].score < 0.7) {
      const cloudResults = await this.volcengineKnowledgeSearch(query);
      return this.mergeResults(localResults, cloudResults);
    }

    return localResults;
  }
}
```

**优势**：
- 本地隐私保护
- 云端补充知识盲区
- 成本可控

### 场景 2: 图像智能分析

**当前实现**：Tesseract.js OCR（仅文本提取）

**增强方案**：OCR + 语义理解

```javascript
// 图像处理流程
async function processImage(imagePath) {
  // 1. OCR 提取文本（本地免费）
  const ocrText = await tesseract.recognize(imagePath);

  // 2. 智能选择视觉模型
  const selector = getModelSelector();
  const model = selector.selectByScenario({
    hasImage: true,
    userBudget: 'medium',
  });

  // 3. 语义理解（火山引擎）
  const analysis = await llmManager.chatWithMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: '请分析图片内容、主题和关键信息' },
        { type: 'image_url', image_url: { url: `file://${imagePath}` } }
      ]
    }
  ]);

  return {
    ocrText: ocrText,           // 文字内容
    semanticAnalysis: analysis, // 语义分析
  };
}
```

**优势**：
- 超越文字识别，理解图片含义
- 支持场景识别、物体检测
- 可用于笔记自动分类

### 场景 3: AI 助手工作流自动化

**新增能力**：Function Calling（函数调用）

```javascript
// 定义可调用函数
const FUNCTIONS = {
  createNote: {
    name: 'create_note',
    description: '创建知识库笔记',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      }
    }
  },

  sendMessage: {
    name: 'send_p2p_message',
    description: '发送加密消息给好友',
    parameters: {
      type: 'object',
      properties: {
        friendDID: { type: 'string' },
        message: { type: 'string' }
      }
    }
  }
};

// 用户：帮我创建一个关于机器学习的笔记，标题是"深度学习入门"
// AI自动调用 create_note 函数，无需手动操作
```

**优势**：
- 自然语言控制应用
- 减少手动操作
- 提升用户体验

### 场景 4: 实时信息增强

**新增能力**：联网搜索

```javascript
// 开启联网模式
const result = await llmManager.chatWithWebSearch([
  { role: 'user', content: '2026年AI技术最新趋势是什么？' }
]);

// AI会自动：
// 1. 识别需要实时信息
// 2. 调用搜索引擎
// 3. 整合搜索结果
// 4. 生成综合回答（带来源引用）
```

**优势**：
- 突破模型训练时间限制
- 获取实时信息（新闻、天气、股票）
- 提升回答准确性

## 📊 成本对比

### 文本生成（100万tokens输入 + 30万tokens输出）

| 模型 | 输入成本 | 输出成本 | 总成本 | 适用场景 |
|------|---------|---------|--------|---------|
| doubao-seed-1.6-lite | ¥0.30 | ¥0.24 | **¥0.54** | 大规模低成本对话 ⭐ |
| doubao-seed-1.6 | ¥0.80 | ¥0.60 | **¥1.40** | 通用推荐 ⭐ |
| doubao-seed-1.6-thinking | ¥1.00 | ¥0.75 | **¥1.75** | 复杂推理 |
| Ollama (本地) | ¥0 | ¥0 | **¥0** | 离线隐私场景 |

### 图像理解（100次图像分析，每次10K tokens）

| 模型 | Token成本 | 图片成本 | 总成本 | 适用场景 |
|------|----------|---------|--------|---------|
| doubao-1.5-vision-lite | ¥0.10 | ¥0.40 | **¥0.50** | 简单图像识别 |
| doubao-seed-1.6-vision | ¥0.26 | ¥1.00 | **¥1.26** | 复杂视觉推理 ⭐ |

### 知识库向量化（100万tokens）

| 模型 | 向量维度 | 成本 | 适用场景 |
|------|---------|------|---------|
| doubao-embedding | 1024 | **¥0.15** | 标准检索 |
| doubao-embedding-large | 2048 | **¥0.20** | 高精度检索 ⭐ |

### 视频生成（5秒短视频）

| 模型 | 每秒价格 | 5秒成本 | 适用场景 |
|------|---------|--------|---------|
| doubao-seedance-1.0-lite | ¥0.15 | **¥0.75** | 快速原型 |
| doubao-seedance-1.5-pro | ¥0.30 | **¥1.50** | 专业级 ⭐ |

## 🎓 最佳实践

### 1. 成本优化策略

```javascript
// 策略1: 根据预算自动降级
function selectModelByBudget(taskType, budget) {
  const selector = getModelSelector();

  if (budget < 10) {
    // 低预算：优先轻量模型
    return selector.selectModel(taskType, { preferCost: true });
  } else if (budget < 50) {
    // 中等预算：平衡性能和成本
    return selector.selectModel(taskType, { preferSpeed: true });
  } else {
    // 高预算：优先质量
    return selector.selectModel(taskType, { preferQuality: true });
  }
}

// 策略2: 混合使用（本地 + 云端）
async function hybridChat(prompt) {
  // 简单问题用本地模型（免费）
  if (isSimpleQuestion(prompt)) {
    return await ollamaClient.chat(prompt);
  }

  // 复杂问题用云端模型（付费但更强）
  return await volcengineClient.chat(prompt);
}
```

### 2. 缓存优化

```javascript
// 使用缓存减少重复调用
const cache = new Map();

async function chatWithCache(prompt, model) {
  const cacheKey = `${model.id}:${prompt}`;

  if (cache.has(cacheKey)) {
    console.log('命中缓存，节省成本');
    return cache.get(cacheKey);
  }

  const result = await llmManager.chat(prompt);
  cache.set(cacheKey, result);

  return result;
}
```

### 3. 分阶段处理

```javascript
// 先用轻量模型筛选，再用高质量模型精细处理
async function twoStageProcessing(documents) {
  // 第一阶段：轻量模型快速筛选（成本低）
  const liteModel = selector.selectByScenario({
    userBudget: 'low',
  });

  const relevantDocs = await filterWithLiteModel(documents, liteModel);

  // 第二阶段：高质量模型深度分析（成本高但精准）
  const proModel = selector.selectByScenario({
    needsThinking: true,
    userBudget: 'high',
  });

  return await analyzeWithProModel(relevantDocs, proModel);
}
```

## 📖 参考资源

### 官方文档
- [函数调用 Function Calling](https://www.volcengine.com/docs/82379/1262342)
- [工具调用概述](https://www.volcengine.com/docs/82379/1958524)
- [豆包大模型 1.8](https://www.volcengine.com/docs/82379/2123228)
- [模型列表](https://www.volcengine.com/docs/82379/1330310)
- [三方工具调用说明](https://www.volcengine.com/docs/82379/1463945)

### 项目文档
- [完整集成方案](./VOLCENGINE_TOOLS_INTEGRATION.md) - 工具调用详细实现
- [模型选择器源码](./desktop-app-vue/src/main/llm/volcengine-models.js)
- [使用示例代码](./desktop-app-vue/src/main/llm/volcengine-model-selector-examples.js)

## ❓ FAQ

**Q1: 火山引擎和 Ollama 如何选择？**

A: 混合使用最佳：
- **本地 Ollama**: 离线场景、隐私数据、大规模免费调用
- **云端火山引擎**: 复杂推理、视觉理解、实时信息、工具调用

**Q2: 智能选择器会自动切换模型吗？**

A: 选择器仅推荐模型，不会自动切换。开发者需要根据推荐结果手动配置。

**Q3: 成本如何控制？**

A: 三种策略：
1. 使用 `estimateCost()` 提前估算
2. 设置每日预算上限
3. 优先使用 `preferCost: true` 选项

**Q4: 支持哪些图片格式？**

A: 支持常见格式（JPEG、PNG、WebP等），建议压缩后上传以降低成本。

**Q5: 视频生成的最大时长？**

A: 当前支持 5-10 秒短视频，具体以模型文档为准。

## 🚧 下一步计划

- [ ] 实现 `volcengine-tools.js`（联网搜索、图像处理客户端）
- [ ] 添加 IPC 处理器（集成到主进程）
- [ ] 创建 UI 配置界面（设置页面）
- [ ] 实现混合检索系统（本地 + 云端）
- [ ] 添加 Function Calling 框架
- [ ] 性能监控和成本统计面板

---

**版本**: v1.0
**更新日期**: 2026-01-04
**作者**: ChainlessChain Team
**联系**: 项目 Issues

🎉 现在你已经掌握了火山引擎豆包的完整集成方案！开始构建更智能的 AI 应用吧！
