# 嵌入模型配置说明

**日期**: 2026-01-04
**版本**: v1.0

## 概述

本文档说明了系统设置中新增的嵌入模型（Embedding Model）配置功能。嵌入模型用于将文本转换为向量表示，用于语义搜索、相似度匹配等功能。

## 支持的提供商和嵌入模型

### 1. Ollama（本地）

- **对话模型**: llama2, qwen2:7b等
- **嵌入模型**: nomic-embed-text（推荐）
- **说明**: 需要先在Ollama中拉取嵌入模型 `ollama pull nomic-embed-text`

### 2. OpenAI

- **对话模型**: gpt-3.5-turbo, gpt-4等
- **嵌入模型**:
  - text-embedding-3-small（推荐，性价比高）
  - text-embedding-3-large（精度更高）
  - text-embedding-ada-002（旧版本）
- **说明**: 使用相同的API Key

### 3. Claude (Anthropic)

- **对话模型**: claude-3-5-sonnet-20241022等
- **嵌入模型**: 暂不支持
- **说明**: Claude目前没有提供嵌入模型API，建议使用OpenAI或其他服务的嵌入模型

### 4. 火山引擎（豆包）

- **对话模型**: doubao-seed-1-6-flash-250828等
- **嵌入模型**: doubao-embedding
- **API地址**: https://ark.cn-beijing.volces.com/api/v3
- **说明**: 火山引擎提供的专用嵌入模型

### 5. 阿里通义千问（DashScope）

- **对话模型**: qwen-turbo, qwen-plus, qwen-max
- **嵌入模型**: text-embedding-v2
- **说明**: 阿里云灵积平台提供的嵌入服务

### 6. 智谱AI

- **对话模型**: glm-4
- **嵌入模型**: embedding-2
- **说明**: 智谱AI提供的文本嵌入模型

### 7. DeepSeek

- **对话模型**: deepseek-chat
- **嵌入模型**: 待确认是否支持
- **说明**: 如DeepSeek支持嵌入模型，可在此配置

## 配置文件

### 后端配置文件

嵌入模型配置保存在 LLM 配置文件中：

**路径**: `~/Library/Application Support/chainlesschain/llm-config.json` (macOS)

**配置结构示例**:

```json
{
  "provider": "volcengine",
  "volcengine": {
    "apiKey": "your-api-key",
    "baseURL": "https://ark.cn-beijing.volces.com/api/v3",
    "model": "doubao-seed-1-6-flash-250828",
    "embeddingModel": "doubao-embedding"
  },
  "openai": {
    "apiKey": "sk-...",
    "baseURL": "https://api.openai.com/v1",
    "model": "gpt-3.5-turbo",
    "embeddingModel": "text-embedding-3-small"
  }
}
```

### 前端配置界面

在系统设置的"AI 模型"标签页中，每个提供商都有独立的配置区域：

1. **对话模型**: 用于LLM对话的模型
2. **嵌入模型**: 用于生成文本向量的模型

## 代码文件

### 修改的文件

1. **desktop-app-vue/src/main/llm/llm-config.js**
   - 在DEFAULT_CONFIG中为所有提供商添加了embeddingModel字段

2. **desktop-app-vue/src/renderer/pages/settings/SystemSettings.vue**
   - 为每个提供商添加了"嵌入模型"输入框
   - 更新了config数据结构以包含嵌入模型字段

## 使用示例

### 设置Volcengine嵌入模型

```javascript
// 通过IPC设置配置
await window.electronAPI.llm.setConfig({
  provider: 'volcengine',
  volcengine: {
    apiKey: '7185ce7d-9775-450c-8450-783176be6265',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-flash-250828',
    embeddingModel: 'doubao-embedding'
  }
});
```

### 在代码中使用嵌入模型

```javascript
const llmConfig = getLLMConfig();
const embeddingModel = llmConfig.get('volcengine.embeddingModel');

// 使用嵌入模型生成向量
const embedding = await generateEmbedding(text, {
  model: embeddingModel,
  provider: 'volcengine'
});
```

## E2E测试修复

之前的测试失败是因为使用了错误的嵌入模型配置：

**问题**: 测试使用了 `text-embedding-ada-002`（OpenAI模型）但提供商是Volcengine

**解决方案**: 在测试的 `setupVolcengineConfig()` 函数中添加嵌入模型配置：

```typescript
const config = {
  provider: 'volcengine',
  'volcengine.apiKey': '7185ce7d-9775-450c-8450-783176be6265',
  'volcengine.baseURL': 'https://ark.cn-beijing.volces.com/api/v3',
  'volcengine.model': 'doubao-seed-1-6-flash-250828',
  'volcengine.embeddingModel': 'doubao-embedding', // 新增
};
```

## 常见问题

### Q1: 如何选择合适的嵌入模型？

- **性价比优先**: OpenAI text-embedding-3-small
- **精度优先**: OpenAI text-embedding-3-large
- **本地部署**: Ollama nomic-embed-text
- **中文优化**: 火山引擎 doubao-embedding 或 阿里 text-embedding-v2

### Q2: 嵌入模型和对话模型必须来自同一提供商吗？

不需要。您可以使用不同提供商的模型，例如：
- 对话模型：Claude (Anthropic)
- 嵌入模型：OpenAI text-embedding-3-small

### Q3: 如何测试嵌入模型配置是否正确？

可以通过系统设置页面的"测试连接"按钮测试对话模型，嵌入模型则需要在实际调用嵌入API时验证。

## 后续优化建议

1. **嵌入模型独立测试**: 添加专门的嵌入模型测试功能
2. **维度自动检测**: 自动检测嵌入模型的向量维度
3. **批量嵌入**: 支持批量文本嵌入以提高效率
4. **模型推荐**: 根据用例（中文/英文、精度/速度）推荐合适的嵌入模型

## 相关文档

- [LLM配置文档](./LLM_CONFIGURATION.md)
- [E2E测试报告](../tests/E2E_TEST_COMPLETION_REPORT.md)
- [系统设计文档](../系统设计_个人移动AI管理系统.md)

---

**维护者**: ChainlessChain Team
**最后更新**: 2026-01-04
