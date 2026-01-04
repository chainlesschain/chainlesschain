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
- **API文档**: [Ollama Embeddings API](https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings)
- **模型列表**: [Ollama Models Library](https://ollama.com/library)

### 2. OpenAI

- **对话模型**: gpt-3.5-turbo, gpt-4等
- **嵌入模型**:
  - text-embedding-3-small（推荐，性价比高，1536维）
  - text-embedding-3-large（精度更高，3072维）
  - text-embedding-ada-002（旧版本，1536维）
- **说明**: 使用相同的API Key
- **API文档**: [OpenAI Embeddings API](https://platform.openai.com/docs/api-reference/embeddings)
- **定价**: [OpenAI Pricing](https://openai.com/pricing)
- **向量维度**: text-embedding-3-small (1536), text-embedding-3-large (3072)

### 3. Claude (Anthropic)

- **对话模型**: claude-3-5-sonnet-20241022等
- **嵌入模型**: 暂不支持
- **说明**: Claude目前没有提供嵌入模型API，建议使用OpenAI或其他服务的嵌入模型
- **API文档**: [Anthropic API Documentation](https://docs.anthropic.com/claude/reference/getting-started-with-the-api)
- **替代方案**: 可使用 [Voyage AI Embeddings](https://docs.voyageai.com/embeddings/)

### 4. 火山引擎（豆包）

- **对话模型**: doubao-seed-1-6-flash-250828等
- **嵌入模型**:
  - doubao-embedding（通用嵌入模型）
  - doubao-embedding-large（大规模嵌入模型）
- **API地址**: https://ark.cn-beijing.volces.com/api/v3
- **说明**: 火山引擎提供的专用嵌入模型，针对中文优化
- **API文档**: [火山引擎大模型服务](https://www.volcengine.com/docs/82379/1099455)
- **控制台**: [火山方舟控制台](https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint)
- **向量维度**: doubao-embedding (1024), doubao-embedding-large (2048)

### 5. 阿里通义千问（DashScope）

- **对话模型**: qwen-turbo, qwen-plus, qwen-max
- **嵌入模型**:
  - text-embedding-v2（推荐）
  - text-embedding-v1（旧版本）
- **说明**: 阿里云灵积平台提供的嵌入服务，中文效果优秀
- **API文档**: [通义千问 Embeddings API](https://help.aliyun.com/zh/dashscope/developer-reference/text-embedding-api-details)
- **控制台**: [阿里云百炼平台](https://bailian.console.aliyun.com/)
- **向量维度**: text-embedding-v2 (1536)

### 6. 智谱AI

- **对话模型**: glm-4, glm-4-flash
- **嵌入模型**:
  - embedding-2（推荐，性能更好）
  - embedding-1（旧版本）
- **说明**: 智谱AI提供的文本嵌入模型，中文支持优秀
- **API文档**: [智谱AI Embeddings API](https://open.bigmodel.cn/dev/api#text_embedding)
- **控制台**: [智谱AI开放平台](https://open.bigmodel.cn/)
- **向量维度**: embedding-2 (1024)

### 7. DeepSeek

- **对话模型**: deepseek-chat, deepseek-coder
- **嵌入模型**: 待确认是否支持
- **说明**: DeepSeek主要提供对话模型，嵌入模型支持待确认
- **API文档**: [DeepSeek API Documentation](https://platform.deepseek.com/api-docs/)
- **控制台**: [DeepSeek Platform](https://platform.deepseek.com/)

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

| 场景 | 推荐模型 | 原因 |
|------|---------|------|
| **性价比优先** | OpenAI text-embedding-3-small | 性能优秀，价格合理，1536维 |
| **精度优先** | OpenAI text-embedding-3-large | 最高精度，3072维向量 |
| **本地部署** | Ollama nomic-embed-text | 完全本地化，无需API密钥 |
| **中文优化（云端）** | 火山引擎 doubao-embedding-large | 专门针对中文优化，2048维 |
| **中文优化（阿里）** | 阿里 text-embedding-v2 | 阿里云灵积，中文效果好 |
| **成本极低** | 智谱AI embedding-2 | 价格便宜，中文支持好 |

### Q2: 嵌入模型和对话模型必须来自同一提供商吗？

**不需要**。您可以混合使用不同提供商的模型，例如：

**推荐组合示例**:
- 对话模型：Claude (Anthropic) - 推理能力强
- 嵌入模型：OpenAI text-embedding-3-small - 性价比高

- 对话模型：火山引擎 doubao-flash - 速度快
- 嵌入模型：火山引擎 doubao-embedding-large - 中文优化

- 对话模型：DeepSeek - 代码能力强
- 嵌入模型：OpenAI text-embedding-3-small - 通用性好

### Q3: 如何测试嵌入模型配置是否正确？

现在系统设置提供了专门的测试功能：

1. **UI测试**（推荐）:
   - 打开"系统设置" → "AI 模型"标签页
   - 配置好提供商和嵌入模型
   - 点击"测试嵌入"按钮
   - 查看测试结果（成功会显示向量维度）

2. **编程测试**:
```javascript
const result = await window.electronAPI.llm.embeddings('测试文本');
console.log('向量维度:', result.length);
console.log('向量示例:', result.slice(0, 5));
```

### Q4: 不同嵌入模型的向量维度有什么影响？

| 维度 | 优点 | 缺点 | 推荐场景 |
|------|------|------|---------|
| **1024维** | 存储占用小，查询快 | 精度略低 | 大规模知识库 |
| **1536维** | 平衡性能和精度 | 适中 | 通用场景 |
| **2048维** | 更高精度 | 存储和计算开销大 | 精度要求高的场景 |
| **3072维** | 最高精度 | 资源消耗最大 | 科研、高精度检索 |

**注意**: 更换嵌入模型后，需要重新生成所有文档的向量嵌入。

### Q5: 嵌入模型的成本如何？

| 提供商 | 嵌入模型 | 价格（每百万tokens） | 备注 |
|--------|---------|---------------------|------|
| **OpenAI** | text-embedding-3-small | $0.02 | 性价比高 |
| **OpenAI** | text-embedding-3-large | $0.13 | 精度最高 |
| **火山引擎** | doubao-embedding | ~¥0.7 | 中文优化 |
| **智谱AI** | embedding-2 | ~¥0.5 | 价格便宜 |
| **阿里** | text-embedding-v2 | ~¥0.7 | 中文效果好 |
| **Ollama** | nomic-embed-text | 免费 | 本地部署 |

*价格仅供参考，以各平台最新定价为准*

### Q6: 嵌入模型切换后怎么办？

切换嵌入模型后的迁移步骤：

1. **备份现有向量数据**
2. **更新配置**：在系统设置中更改嵌入模型
3. **重新生成嵌入**：
   - 对于知识库：需要重新对所有文档生成嵌入
   - 对于历史数据：建议批量重新处理
4. **验证效果**：测试几个查询确保新模型工作正常

**提示**: 不同模型的向量维度可能不同，需要更新向量数据库的索引配置。

## 后续优化建议

1. ✅ **嵌入模型独立测试**: 已完成 - 系统设置中添加了"测试嵌入"按钮
2. **维度自动检测**: 自动检测嵌入模型的向量维度并更新向量数据库配置
3. **批量嵌入**: 支持批量文本嵌入以提高效率（减少API调用次数）
4. **模型推荐系统**: 根据用例（中文/英文、精度/速度）自动推荐合适的嵌入模型
5. **嵌入缓存**: 对常用文本的嵌入向量进行缓存，提高响应速度
6. **嵌入质量评估**: 添加嵌入质量评估功能，对比不同模型的效果
7. **成本统计**: 统计嵌入模型的使用成本和token消耗

## 相关文档

- [LLM配置文档](./LLM_CONFIGURATION.md)
- [E2E测试报告](../tests/E2E_TEST_COMPLETION_REPORT.md)
- [系统设计文档](../系统设计_个人移动AI管理系统.md)

---

**维护者**: ChainlessChain Team
**最后更新**: 2026-01-04
