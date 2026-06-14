# 火山引擎豆包工具调用集成方案

## 📋 概述

本文档说明如何利用火山引擎豆包的工具调用（Tool Call）功能来增强 ChainlessChain 的 AI 能力。

根据火山引擎官方文档，豆包 1.8 模型支持以下工具调用能力：

1. **联网搜索 (Web Search)** - 实时网络信息检索
2. **图像处理 (Image Process)** - 图像理解和分析
3. **私域知识库搜索 (Knowledge Search)** - 企业知识库检索
4. **函数调用 (Function Calling)** - 自定义函数集成
5. **MCP/Remote MCP** - 模型上下文协议部署

## 📊 火山引擎豆包完整模型列表

### 模型分类总览

火山引擎豆包提供 30+ 专业模型，覆盖文本、视觉、图像生成、视频生成、嵌入等多个领域：

| 类别 | 模型数量 | 代表模型 | 应用场景 |
|------|---------|---------|---------|
| **文本生成** | 7个 | doubao-seed-1.6 | 通用对话、长文本、深度思考 |
| **视觉理解** | 5个 | doubao-seed-1.6-vision | 图像/视频理解、GUI自动化 |
| **图像生成** | 4个 | doubao-seedream-4.5 | 营销图片、创意设计、图像编辑 |
| **视频生成** | 4个 | doubao-seedance-1.5-pro | 短视频、动画、MV |
| **向量嵌入** | 3个 | doubao-embedding-large | 知识库检索、RAG系统 |
| **专用模型** | 4个 | doubao-seed3d-1.0 | 翻译、3D生成、代码、UI自动化 |

### 推荐模型（⭐）

以下是针对常见任务的推荐模型：

```javascript
// 1. 通用AI对话 - 豆包 Seed 1.6
{
  id: 'doubao-seed-1.6',
  上下文: '256K',
  能力: ['深度思考', '函数调用', '长文本'],
  价格: '¥0.8/百万tokens（输入）',
}

// 2. 视觉理解 - 豆包 Seed 1.6 Vision
{
  id: 'doubao-seed-1.6-vision',
  上下文: '256K',
  能力: ['图像理解', '视频理解', 'GUI Agent', '深度思考'],
  价格: '¥2.6/百万tokens + ¥0.01/图',
}

// 3. 图像生成 - Seedream 4.5
{
  id: 'doubao-seedream-4.5',
  能力: ['文生图', '多风格', '多比例'],
  价格: '¥0.08/张（标准）- ¥0.15/张（高清）',
}

// 4. 视频生成 - Seedance 1.5 Pro
{
  id: 'doubao-seedance-1.5-pro',
  能力: ['首尾帧控制', '多镜头', '高动态'],
  价格: '¥0.3/秒',
}

// 5. 文本嵌入 - Embedding Large
{
  id: 'doubao-embedding-large',
  向量维度: '2048',
  价格: '¥0.2/百万tokens',
}
```

### 智能模型选择器

项目已实现智能模型选择器（`volcengine-models.js`），可根据任务自动选择最优模型：

```javascript
const { getModelSelector } = require('./llm/volcengine-models');
const selector = getModelSelector();

// 场景1: AI对话（低成本）
const model = selector.selectByScenario({
  userBudget: 'low',
});
// 返回: doubao-seed-1.6-lite（¥0.3/百万tokens）

// 场景2: 图像理解 + 深度思考
const model = selector.selectByScenario({
  hasImage: true,
  needsThinking: true,
  userBudget: 'high',
});
// 返回: doubao-seed-1.6-vision（256K上下文）

// 场景3: 知识库向量化（大规模）
const model = selector.selectByScenario({
  needsEmbedding: true,
  userBudget: 'medium',
});
// 返回: doubao-embedding-large（2048维）

// 场景4: 视频生成（专业）
const model = selector.selectByScenario({
  needsVideoGeneration: true,
  userBudget: 'high',
});
// 返回: doubao-seedance-1.5-pro（首尾帧控制）
```

**使用示例**：

```bash
# 运行所有示例
node desktop-app-vue/src/main/llm/volcengine-model-selector-examples.js
```

输出将展示12个场景的智能选择结果和成本估算。

## 🎯 集成价值

### 现有功能对比

| 功能 | 当前实现 | 火山引擎工具调用 | 增强价值 |
|------|---------|-----------------|---------|
| 知识库检索 | 本地 RAG (ChromaDB) | 私域知识库搜索 | 云端备份方案 ✅ |
| 图像处理 | OCR (Tesseract.js) | 图像理解（1.6-vision） | 语义理解 + GUI Agent ✅ |
| 视频理解 | ❌ 不支持 | 视频生成/理解模型 | **新增能力** ⭐ |
| 实时信息 | ❌ 不支持 | 联网搜索 | **新增能力** ⭐ |
| 工具集成 | ❌ 不支持 | Function Calling | **新增能力** ⭐ |
| 图像生成 | ❌ 不支持 | Seedream 4.5 | **新增能力** ⭐ |
| 视频生成 | ❌ 不支持 | Seedance 1.5 Pro | **新增能力** ⭐ |
| 标准化协议 | ❌ 不支持 | MCP | **新增能力** ⭐ |

## 🔧 技术实现方案

### 1. 联网搜索 (Web Search)

**应用场景**：
- AI 聊天时获取最新信息（新闻、天气、股票等）
- 增强知识库问答的时效性
- 辅助项目决策（查询技术文档、最佳实践）

**实现方式**：

```javascript
// desktop-app-vue/src/main/llm/volcengine-tools.js
class VolcengineToolsClient {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL || 'https://ark.cn-beijing.volces.com/api/v3';
    this.model = config.model || 'doubao-pro-32k';
  }

  /**
   * 启用联网搜索的聊天
   */
  async chatWithWebSearch(messages, options = {}) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        // 启用联网搜索工具
        tools: [
          {
            type: 'web_search',
            web_search: {
              search_mode: 'auto', // auto | always | never
            }
          }
        ],
        stream: options.stream || false,
      })
    });

    return await response.json();
  }
}
```

**IPC 集成**：

```javascript
// desktop-app-vue/src/main/index.js
ipcMain.handle('llm:chat-with-web-search', async (event, { messages, options }) => {
  try {
    const config = llmConfig.getProviderConfig('volcengine');

    if (!config.apiKey) {
      throw new Error('火山引擎 API Key 未配置');
    }

    const toolsClient = new VolcengineToolsClient(config);
    const result = await toolsClient.chatWithWebSearch(messages, options);

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    console.error('[IPC] 联网搜索聊天失败:', error);
    return {
      success: false,
      error: error.message,
    };
  }
});
```

### 2. 图像处理 (Image Process)

**应用场景**：
- 增强图像 OCR 的语义理解（补充 Tesseract.js）
- 图片内容分析（场景识别、物体检测）
- 图文混排笔记的智能解析

**实现方式**：

```javascript
/**
 * 启用图像处理的聊天
 */
async chatWithImageProcess(messages, imageUrl, options = {}) {
  const response = await fetch(`${this.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    },
    body: JSON.stringify({
      model: this.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: messages[messages.length - 1].content,
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
              }
            }
          ]
        }
      ],
      // 启用图像处理工具
      tools: [
        {
          type: 'image_process',
        }
      ],
    })
  });

  return await response.json();
}
```

**集成到现有图像导入流程**：

```javascript
// desktop-app-vue/src/main/image/image-processor.js
async processImageWithAI(imagePath) {
  // 1. 现有 OCR 提取文本
  const ocrText = await this.extractTextWithOCR(imagePath);

  // 2. 使用火山引擎进行语义理解
  const volcengineClient = new VolcengineToolsClient(config);
  const aiAnalysis = await volcengineClient.chatWithImageProcess(
    [{ role: 'user', content: '请分析这张图片的内容，包括场景、主题和关键信息。' }],
    `file://${imagePath}`
  );

  return {
    ocrText: ocrText,           // 文本提取
    aiAnalysis: aiAnalysis,     // 语义理解
    timestamp: Date.now(),
  };
}
```

### 3. 私域知识库搜索 (Knowledge Search)

**应用场景**：
- 作为本地 RAG 系统的云端备份方案
- 团队知识库共享（企业场景）
- 多设备知识同步

**实现方式**：

```javascript
/**
 * 配置私域知识库
 */
async setupKnowledgeBase(knowledgeBaseId, documents) {
  // 1. 上传文档到火山引擎知识库
  const uploadResponse = await fetch(`${this.baseURL}/knowledge_base/${knowledgeBaseId}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    },
    body: JSON.stringify({
      documents: documents,
    })
  });

  return await uploadResponse.json();
}

/**
 * 使用知识库增强的聊天
 */
async chatWithKnowledgeBase(messages, knowledgeBaseId, options = {}) {
  const response = await fetch(`${this.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    },
    body: JSON.stringify({
      model: this.model,
      messages: messages,
      // 启用知识库搜索工具
      tools: [
        {
          type: 'knowledge_search',
          knowledge_search: {
            knowledge_base_id: knowledgeBaseId,
            top_k: 5,                    // 返回前5个最相关结果
            score_threshold: 0.7,        // 相似度阈值
            enable_rerank: true,         // 启用重排序
          }
        }
      ],
    })
  });

  return await response.json();
}
```

**混合检索策略**（本地 + 云端）：

```javascript
// desktop-app-vue/src/main/rag/hybrid-retrieval.js
class HybridRetrievalManager {
  constructor() {
    this.localRAG = new RAGManager();           // 本地 ChromaDB
    this.volcengineTools = new VolcengineToolsClient(config);
  }

  /**
   * 混合检索：本地优先，云端补充
   */
  async retrieve(query, options = {}) {
    const results = {
      local: [],
      cloud: [],
      merged: [],
    };

    try {
      // 1. 本地检索（速度快，隐私好）
      results.local = await this.localRAG.search(query, { topK: 5 });

      // 2. 如果本地结果不足或分数低，使用云端检索补充
      const needCloudBackup = results.local.length < 3 ||
                              results.local[0]?.score < 0.7;

      if (needCloudBackup && options.enableCloud) {
        const cloudResponse = await this.volcengineTools.chatWithKnowledgeBase(
          [{ role: 'user', content: query }],
          options.knowledgeBaseId
        );
        results.cloud = this.parseCloudResults(cloudResponse);
      }

      // 3. 合并去重
      results.merged = this.mergeResults(results.local, results.cloud);

      return results;
    } catch (error) {
      console.error('[HybridRetrieval] 检索失败:', error);
      // Fallback 到本地结果
      return { ...results, merged: results.local };
    }
  }
}
```

### 4. 函数调用 (Function Calling)

**应用场景**：
- AI 助手调用项目内部功能（创建笔记、查询项目、发送消息）
- 实现智能命令（"帮我创建一个关于机器学习的笔记"）
- 工作流自动化

**实现方式**：

```javascript
/**
 * 定义可调用的函数
 */
const AVAILABLE_FUNCTIONS = {
  createNote: {
    name: 'create_note',
    description: '创建一个新的知识库笔记',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: '笔记标题',
        },
        content: {
          type: 'string',
          description: '笔记内容（Markdown格式）',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签列表',
        }
      },
      required: ['title', 'content'],
    }
  },

  searchNotes: {
    name: 'search_notes',
    description: '搜索知识库中的笔记',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词',
        },
        limit: {
          type: 'number',
          description: '返回结果数量',
          default: 10,
        }
      },
      required: ['query'],
    }
  },

  sendP2PMessage: {
    name: 'send_p2p_message',
    description: '发送 P2P 加密消息给好友',
    parameters: {
      type: 'object',
      properties: {
        friendDID: {
          type: 'string',
          description: '好友的 DID 标识',
        },
        message: {
          type: 'string',
          description: '消息内容',
        }
      },
      required: ['friendDID', 'message'],
    }
  },

  queryProjects: {
    name: 'query_projects',
    description: '查询项目列表',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'completed', 'archived'],
          description: '项目状态',
        }
      }
    }
  }
};

/**
 * 函数执行器
 */
class FunctionExecutor {
  constructor(app) {
    this.app = app;
    this.database = app.database;
    this.p2pManager = app.p2pManager;
  }

  async execute(functionName, args) {
    switch (functionName) {
      case 'create_note':
        return await this.database.createNote({
          title: args.title,
          content: args.content,
          tags: args.tags || [],
          createdAt: Date.now(),
        });

      case 'search_notes':
        return await this.database.searchNotes(args.query, {
          limit: args.limit || 10,
        });

      case 'send_p2p_message':
        return await this.p2pManager.sendMessage(args.friendDID, args.message);

      case 'query_projects':
        // 调用后端 project-service API
        return await this.queryProjectsFromBackend(args);

      default:
        throw new Error(`未知函数: ${functionName}`);
    }
  }
}

/**
 * Function Calling 聊天
 */
async chatWithFunctionCalling(messages, options = {}) {
  const response = await fetch(`${this.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    },
    body: JSON.stringify({
      model: this.model,
      messages: messages,
      // 定义可用函数
      tools: Object.values(AVAILABLE_FUNCTIONS).map(func => ({
        type: 'function',
        function: func,
      })),
      tool_choice: 'auto', // 让模型自动决定是否调用函数
    })
  });

  const result = await response.json();

  // 如果模型决定调用函数
  if (result.choices[0].message.tool_calls) {
    const toolCalls = result.choices[0].message.tool_calls;
    const executor = new FunctionExecutor(this.app);

    // 执行函数调用
    const functionResults = [];
    for (const toolCall of toolCalls) {
      const functionName = toolCall.function.name;
      const functionArgs = JSON.parse(toolCall.function.arguments);

      try {
        const result = await executor.execute(functionName, functionArgs);
        functionResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: functionName,
          content: JSON.stringify(result),
        });
      } catch (error) {
        functionResults.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: functionName,
          content: JSON.stringify({ error: error.message }),
        });
      }
    }

    // 将函数结果返回给模型，获取最终回答
    const finalMessages = [
      ...messages,
      result.choices[0].message,
      ...functionResults,
    ];

    return await this.chatWithFunctionCalling(finalMessages, options);
  }

  return result;
}
```

### 5. MCP (Model Context Protocol)

**应用场景**：
- 标准化的工具集成协议
- 第三方工具生态接入
- 企业级部署

**实现方式**：

```javascript
/**
 * MCP 服务器配置
 */
const MCP_CONFIG = {
  serverURL: 'https://your-mcp-server.com',
  tools: [
    'web_search',
    'image_process',
    'knowledge_search',
    'custom_tools',
  ]
};

/**
 * 使用 Remote MCP
 */
async chatWithMCP(messages, options = {}) {
  const response = await fetch(`${this.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    },
    body: JSON.stringify({
      model: this.model,
      messages: messages,
      // 使用 MCP 协议
      tools: [
        {
          type: 'remote_mcp',
          remote_mcp: {
            server_url: MCP_CONFIG.serverURL,
            tools: MCP_CONFIG.tools,
          }
        }
      ],
    })
  });

  return await response.json();
}
```

## 📦 实现步骤

### Phase 1: 基础集成（1-2周）

1. **创建工具客户端模块**
   ```bash
   desktop-app-vue/src/main/llm/volcengine-tools.js
   ```

2. **添加 IPC 处理器**
   - `llm:chat-with-web-search`
   - `llm:chat-with-image`
   - `llm:chat-with-function-calling`

3. **UI 配置界面**
   - 在设置页面添加工具调用开关
   - 配置知识库 ID
   - 选择启用的工具类型

### Phase 2: 功能增强（2-3周）

1. **混合检索系统**
   - 实现本地 + 云端双重检索
   - 结果合并与去重
   - 性能优化

2. **Function Calling 框架**
   - 定义核心函数集
   - 实现函数执行器
   - 添加权限控制

3. **联网搜索集成**
   - AI 聊天界面添加"联网模式"开关
   - 实时信息查询
   - 搜索结果引用

### Phase 3: 高级特性（3-4周）

1. **MCP 协议支持**
2. **工具组合使用**（Web Search + Function Calling）
3. **性能监控与日志**

## 🎨 UI/UX 设计建议

### 聊天界面增强

```vue
<!-- desktop-app-vue/src/renderer/pages/AIChat.vue -->
<template>
  <div class="ai-chat">
    <!-- 工具栏 -->
    <div class="toolbar">
      <a-switch
        v-model:checked="enableWebSearch"
        checked-children="联网搜索"
        un-checked-children="本地模式"
      />
      <a-switch
        v-model:checked="enableFunctionCalling"
        checked-children="函数调用"
        un-checked-children="仅对话"
      />
    </div>

    <!-- 消息显示 -->
    <div class="messages">
      <div v-for="msg in messages" :key="msg.id">
        <!-- 如果有函数调用 -->
        <div v-if="msg.toolCalls" class="tool-calls">
          <a-tag color="blue">🔧 调用了 {{ msg.toolCalls.length }} 个工具</a-tag>
          <a-collapse>
            <a-collapse-panel
              v-for="call in msg.toolCalls"
              :key="call.id"
              :header="call.function.name"
            >
              <pre>{{ call.function.arguments }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </div>

        <!-- 如果有搜索结果 -->
        <div v-if="msg.searchResults" class="search-results">
          <a-tag color="green">🔍 联网搜索了 {{ msg.searchResults.length }} 个来源</a-tag>
          <a-list size="small" :data-source="msg.searchResults">
            <template #renderItem="{ item }">
              <a-list-item>
                <a :href="item.url" target="_blank">{{ item.title }}</a>
              </a-list-item>
            </template>
          </a-list>
        </div>

        <!-- 消息内容 -->
        <div class="message-content">
          {{ msg.content }}
        </div>
      </div>
    </div>
  </div>
</template>
```

## 🔐 安全与隐私

### 1. 数据隔离

- **本地优先**: 敏感数据优先使用本地 RAG，不上传云端
- **用户控制**: 所有云端功能需用户显式授权
- **数据加密**: 上传到知识库的数据需加密存储

### 2. 权限控制

```javascript
// Function Calling 权限检查
class PermissionManager {
  constructor() {
    // 敏感函数需要额外确认
    this.sensitiveActions = [
      'send_p2p_message',
      'delete_note',
      'modify_settings',
    ];
  }

  async checkPermission(functionName, args) {
    if (this.sensitiveActions.includes(functionName)) {
      // 弹出确认对话框
      const confirmed = await dialog.showMessageBox({
        type: 'question',
        buttons: ['允许', '拒绝'],
        title: '函数调用确认',
        message: `AI 助手想要调用 ${functionName}`,
        detail: JSON.stringify(args, null, 2),
      });

      return confirmed.response === 0;
    }

    return true;
  }
}
```

## 📊 成本估算

### API 调用成本（火山引擎豆包）

| 功能 | 计费方式 | 预估成本 |
|------|---------|---------|
| 联网搜索 | 按次计费 | ¥0.01/次 |
| 图像处理 | 按图片计费 | ¥0.02/张 |
| 知识库搜索 | 按 Token 计费 | ¥0.008/1K tokens |
| Function Calling | 按 Token 计费 | ¥0.008/1K tokens |

**月度预算建议**: ¥50-200/用户（中度使用）

## 🧪 测试计划

### 单元测试

```javascript
// tests/unit/volcengine-tools.test.js
describe('VolcengineToolsClient', () => {
  test('联网搜索返回正确格式', async () => {
    const client = new VolcengineToolsClient(config);
    const result = await client.chatWithWebSearch([
      { role: 'user', content: '今天北京天气如何？' }
    ]);

    expect(result.choices[0].message.tool_calls).toBeDefined();
    expect(result.choices[0].message.tool_calls[0].function.name).toBe('web_search');
  });

  test('Function Calling 执行成功', async () => {
    const executor = new FunctionExecutor(app);
    const result = await executor.execute('create_note', {
      title: '测试笔记',
      content: '这是一个测试',
    });

    expect(result.success).toBe(true);
    expect(result.noteId).toBeDefined();
  });
});
```

### E2E 测试

```javascript
// tests/e2e/ai-tools.e2e.test.js
describe('AI 工具调用 E2E', () => {
  test('用户可以启用联网搜索并获取实时信息', async () => {
    // 1. 打开设置，启用联网搜索
    await app.client.click('#settings-link');
    await app.client.click('#enable-web-search');

    // 2. 发送需要实时信息的问题
    await app.client.click('#ai-chat-link');
    await app.client.setValue('#chat-input', '2025年奥运会在哪里举办？');
    await app.client.click('#send-button');

    // 3. 验证返回结果包含搜索来源
    const response = await app.client.getText('.message-content');
    expect(response).toContain('2025');

    const searchResults = await app.client.$$('.search-results');
    expect(searchResults.length).toBeGreaterThan(0);
  });
});
```

## 📚 参考文档

### 火山引擎官方文档
- [函数调用 Function Calling](https://www.volcengine.com/docs/82379/1262342)
- [工具调用概述](https://www.volcengine.com/docs/82379/1958524)
- [豆包大模型 1.8](https://www.volcengine.com/docs/82379/2123228)
- [三方工具调用说明](https://www.volcengine.com/docs/82379/1463945)

### OpenAI 兼容性
- 火山引擎 API 兼容 OpenAI SDK
- Base URL: `https://ark.cn-beijing.volces.com/api/v3`
- 支持流式输出和 Function Calling

## 🚀 快速开始

### 1. 配置 API Key

```bash
# 在桌面应用设置中配置
设置 -> LLM 配置 -> 火山引擎 -> API Key
```

### 2. 启用工具调用

```javascript
// desktop-app-vue/src/main/llm/llm-config.js
volcengine: {
  apiKey: 'your-api-key',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-pro-32k',
  embeddingModel: 'doubao-embedding-text-240715',

  // 新增：工具调用配置
  tools: {
    webSearch: true,           // 启用联网搜索
    imageProcess: true,        // 启用图像处理
    knowledgeSearch: false,    // 启用知识库搜索（需配置知识库ID）
    functionCalling: true,     // 启用函数调用
    knowledgeBaseId: '',       // 知识库ID（可选）
  }
}
```

### 3. 测试功能

```javascript
// 示例：联网搜索
const result = await ipcRenderer.invoke('llm:chat-with-web-search', {
  messages: [
    { role: 'user', content: '最新的 AI 技术趋势是什么？' }
  ],
  options: {
    enableWebSearch: true,
  }
});

console.log('AI 回答:', result.data.choices[0].message.content);
console.log('搜索来源:', result.data.choices[0].message.search_results);
```

## ✅ 总结

火山引擎豆包的工具调用能力可以显著增强 ChainlessChain 的 AI 功能：

1. **联网搜索** - 补充实时信息获取能力 ⭐⭐⭐⭐⭐
2. **图像处理** - 增强现有 OCR 的语义理解 ⭐⭐⭐⭐
3. **Function Calling** - 实现 AI 助手自动化 ⭐⭐⭐⭐⭐
4. **知识库搜索** - 提供云端备份方案 ⭐⭐⭐
5. **MCP 协议** - 标准化工具集成 ⭐⭐⭐

**建议优先级**：Function Calling > 联网搜索 > 图像处理 > 知识库搜索 > MCP

---

*文档版本: v1.0*
*更新日期: 2026-01-04*
*作者: ChainlessChain Team*

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：火山引擎豆包工具调用集成方案。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
