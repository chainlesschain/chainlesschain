# AI模型配置

ChainlessChain 支持多种AI模型，包括本地部署和云端API，满足不同的使用需求。

## 模型类型

### 1. LLM (大语言模型)

用于对话、推理和内容生成：
- **本地模型**: 隐私保护，无需联网
- **云端API**: 性能最强，需要费用

### 2. Embedding模型

用于文本向量化，支持语义搜索：
- **本地模型**: 离线可用
- **云端API**: 更高精度

### 3. RAG (检索增强生成)

结合向量检索和LLM，提供知识库问答。

## 本地LLM部署

### PC端部署

#### 使用Ollama（推荐）

```bash
# 1. 安装Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# 或Windows
winget install Ollama.Ollama

# 2. 启动Ollama服务
ollama serve

# 3. 下载模型
ollama pull qwen2:7b        # 通义千问7B
ollama pull llama3:8b       # LLaMA3 8B
ollama pull phi3:mini       # Phi-3 Mini 3.8B
```

#### 模型推荐

| 模型 | 参数量 | 内存需求 | 速度 | 质量 | 适用场景 |
|------|--------|----------|------|------|----------|
| Phi-3 Mini | 3.8B | 8GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 低配PC |
| Qwen2 | 7B | 16GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 通用推荐 |
| LLaMA3 | 8B | 16GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 通用推荐 |
| Qwen2 | 14B | 32GB | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 高性能PC |
| LLaMA3 | 70B | 64GB+ GPU | ⭐⭐ | ⭐⭐⭐⭐⭐ | 专业用户 |

#### 配置Ollama

在ChainlessChain中配置：

```json
{
  "ai": {
    "llmProvider": "ollama",
    "llmConfig": {
      "baseURL": "http://localhost:11434",
      "model": "qwen2:7b",
      "temperature": 0.7,
      "maxTokens": 2000,
      "contextWindow": 8192
    }
  }
}
```

#### Docker部署（可选）

```yaml
# docker-compose.yml
version: '3.8'

services:
  ollama:
    image: ollama/ollama:latest
    container_name: chainlesschain-llm
    ports:
      - "11434:11434"
    volumes:
      - ./ollama_data:/root/.ollama
    environment:
      - OLLAMA_HOST=0.0.0.0
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

启动：
```bash
docker-compose up -d
docker exec -it chainlesschain-llm ollama pull qwen2:7b
```

### 移动端部署

#### Android

使用MLC LLM运行量化模型：

```kotlin
// 1. 添加依赖
dependencies {
    implementation 'ai.mlc:mlc-llm-android:0.1.0'
}

// 2. 初始化模型
class LocalLLM(context: Context) {
    private val mlcEngine = MLCEngine(context)

    suspend fun initialize() {
        // 下载量化模型（约1-2GB）
        val modelPath = downloadModel("MiniCPM-2B-Q4")
        mlcEngine.loadModel(modelPath)
    }

    suspend fun chat(prompt: String): String {
        return mlcEngine.generate(prompt, maxTokens = 512)
    }
}
```

推荐模型：
- **MiniCPM-2B**: 2.4B参数，移动端最优
- **Gemma-2B**: 2B参数，速度快
- **Phi-3 Mini**: 3.8B参数，质量好

#### iOS

使用Core ML：

```swift
import CoreML

class LocalLLM {
    private var model: MLModel?

    func initialize() {
        // 加载.mlpackage模型
        let modelURL = Bundle.main.url(
            forResource: "MiniCPM-2B",
            withExtension: "mlpackage"
        )!
        model = try? MLModel(contentsOf: modelURL)
    }

    func generate(prompt: String) async -> String {
        let input = MLDictionary(["input_text": prompt])
        let output = try? model?.prediction(from: input)
        return output?["generated_text"] as? String ?? ""
    }
}
```

## 云端API配置

### OpenAI

#### 注册和获取API Key

```
1. 访问 https://platform.openai.com
2. 注册账号
3. API Keys → Create new secret key
4. 复制保存API Key (sk-...)
```

#### 配置

```json
{
  "ai": {
    "llmProvider": "openai",
    "llmConfig": {
      "apiKey": "sk-...",
      "model": "gpt-4",
      "baseURL": "https://api.openai.com/v1",
      "temperature": 0.7,
      "maxTokens": 2000
    }
  }
}
```

#### 支持的模型

| 模型 | 费用 (输入/输出) | 上下文 | 特点 |
|------|------------------|--------|------|
| gpt-3.5-turbo | $0.50 / $1.50 / 1M tokens | 16K | 性价比高 |
| gpt-4 | $30 / $60 / 1M tokens | 8K | 最强性能 |
| gpt-4-turbo | $10 / $30 / 1M tokens | 128K | 长上下文 |
| gpt-4o | $5 / $15 / 1M tokens | 128K | 最新最优 |

### Anthropic Claude

#### 配置

```json
{
  "ai": {
    "llmProvider": "anthropic",
    "llmConfig": {
      "apiKey": "sk-ant-...",
      "model": "claude-3-opus-20240229",
      "temperature": 0.7,
      "maxTokens": 4096
    }
  }
}
```

#### 模型对比

| 模型 | 费用 | 上下文 | 特点 |
|------|------|--------|------|
| claude-3-haiku | $0.25 / $1.25 / 1M | 200K | 快速便宜 |
| claude-3-sonnet | $3 / $15 / 1M | 200K | 平衡 |
| claude-3-opus | $15 / $75 / 1M | 200K | 最强推理 |

### 国内大模型

#### 通义千问

```json
{
  "ai": {
    "llmProvider": "qwen",
    "llmConfig": {
      "apiKey": "sk-...",
      "model": "qwen-max",
      "baseURL": "https://dashscope.aliyuncs.com/api/v1"
    }
  }
}
```

#### 文心一言

```json
{
  "ai": {
    "llmProvider": "ernie",
    "llmConfig": {
      "apiKey": "...",
      "secretKey": "...",
      "model": "ERNIE-Bot-4"
    }
  }
}
```

## Embedding模型配置

### 本地Embedding

#### 使用sentence-transformers

```python
from sentence_transformers import SentenceTransformer

# PC端 - 大模型
model = SentenceTransformer('BAAI/bge-large-zh-v1.5')

# 移动端 - 小模型
model_mobile = SentenceTransformer('BAAI/bge-small-zh-v1.5')

# 向量化
embeddings = model.encode(['文本1', '文本2'])
```

#### 配置

```json
{
  "ai": {
    "embeddingProvider": "local",
    "embeddingConfig": {
      "model": "BAAI/bge-large-zh-v1.5",
      "dimensions": 1024,
      "maxBatchSize": 32,
      "device": "cuda"  // 或 "cpu"
    }
  }
}
```

### 云端Embedding

#### OpenAI Embeddings

```json
{
  "ai": {
    "embeddingProvider": "openai",
    "embeddingConfig": {
      "apiKey": "sk-...",
      "model": "text-embedding-ada-002",
      "dimensions": 1536
    }
  }
}
```

费用: $0.10 / 1M tokens

## RAG配置

### 基本配置

```json
{
  "ai": {
    "ragEnabled": true,
    "ragConfig": {
      "topK": 5,
      "minScore": 0.7,
      "reranking": true,
      "contextWindow": 4000,
      "chunkSize": 500,
      "chunkOverlap": 50
    }
  }
}
```

### 高级配置

#### 混合检索

```json
{
  "ragConfig": {
    "retrievalMode": "hybrid",
    "vectorWeight": 0.7,
    "keywordWeight": 0.3,
    "fusion": "rrf"  // Reciprocal Rank Fusion
  }
}
```

#### 重排序

```json
{
  "ragConfig": {
    "reranking": true,
    "rerankerModel": "BAAI/bge-reranker-large",
    "rerankerTopK": 3
  }
}
```

## 查询模板

### 创建模板

```
设置 → AI → 查询模板 → 新建

模板信息:
- 名称: 编程助手
- 关联知识库: 技术文档、代码笔记
- LLM模型: qwen2:7b
- RAG模型: bge-large-zh-v1.5
- 系统提示词: (见下方)
- Temperature: 0.3
- Max Tokens: 3000
```

### 系统提示词示例

#### 通用问答

```
你是一个智能助手，基于用户的个人知识库回答问题。
请遵循以下原则：
1. 只使用检索到的知识库内容回答
2. 如果知识库中没有相关信息，明确告知用户
3. 提供详细准确的答案
4. 必要时引用原文
```

#### 编程助手

```
你是一个专业的编程助手，帮助用户解决编程问题。
知识库包含用户的技术笔记和代码片段。

回答要求：
1. 基于知识库中的代码示例
2. 提供完整可运行的代码
3. 解释代码逻辑
4. 指出潜在问题
5. 建议最佳实践
```

#### 文案优化

```
你是一个专业的文案编辑，帮助用户优化文字表达。

任务：
1. 分析用户的草稿
2. 提出改进建议
3. 提供优化后的版本
4. 保持原意，提升表达质量
```

## 性能优化

### 缓存策略

```json
{
  "ai": {
    "cacheEnabled": true,
    "cacheConfig": {
      "embeddingCache": true,
      "embeddingCacheTTL": 86400,  // 24小时
      "llmResponseCache": false,   // 关闭以获得多样化回答
      "maxCacheSize": 1000
    }
  }
}
```

### 批处理

```python
# 批量向量化
texts = ['文本1', '文本2', ..., '文本100']

# 不推荐：逐个处理
embeddings = [model.encode(text) for text in texts]

# 推荐：批处理
embeddings = model.encode(texts, batch_size=32)
```

### GPU加速

```json
{
  "ai": {
    "device": "cuda",
    "gpuMemoryFraction": 0.8,
    "precision": "fp16"  // 半精度，提升速度
  }
}
```

## 成本优化

### 混合部署策略

```typescript
class AIRouter {
    async route(query: string, context: any) {
        // 1. 简单问题 → 本地小模型
        if (context.length < 1000) {
            return this.localLLM.generate(query)
        }

        // 2. 复杂问题 → 本地大模型
        if (this.localLargeModel.available && !this.needHighQuality(query)) {
            return this.localLargeModel.generate(query)
        }

        // 3. 高质量要求 → 云端API
        return this.cloudAPI.generate(query)
    }
}
```

### Token使用优化

```typescript
// 1. 精简提示词
const systemPrompt = "你是助手，简洁回答。"  // 而非长篇大论

// 2. 限制上下文
const context = relevantDocs.slice(0, 3)  // 只用最相关的3个文档

// 3. 控制输出长度
const maxTokens = 500  // 根据需求调整
```

## 模型评估

### 质量评估

```python
# 评估检索质量
def evaluate_retrieval(test_queries, ground_truth):
    scores = {
        'precision': [],
        'recall': [],
        'ndcg': []
    }

    for query, truth in zip(test_queries, ground_truth):
        retrieved = rag.retrieve(query)
        scores['precision'].append(precision(retrieved, truth))
        scores['recall'].append(recall(retrieved, truth))
        scores['ndcg'].append(ndcg(retrieved, truth))

    return scores

# 评估生成质量
def evaluate_generation(test_cases):
    scores = []
    for query, expected_answer in test_cases:
        generated = llm.generate(query)
        score = similarity(generated, expected_answer)
        scores.append(score)
    return np.mean(scores)
```

### 性能监控

```
设置 → AI → 性能监控

指标:
- 平均响应时间
- 每日Token消耗
- 检索精度
- 用户满意度（评分）

图表:
- 每日使用量趋势
- 不同模型的成本对比
- 响应速度分布
```

## 故障排查

### 本地模型加载失败

**常见问题**:
```
Error: Failed to load model

原因:
1. 内存不足
2. 模型文件损坏
3. 依赖缺失

解决:
1. 检查内存: htop / 任务管理器
2. 重新下载模型: ollama pull qwen2:7b
3. 检查日志: ~/.ollama/logs/
```

### API调用失败

**检查清单**:
```
□ API Key是否正确
□ 账户余额是否充足
□ 网络连接是否正常
□ 是否超过速率限制
□ baseURL是否正确
```

### 响应速度慢

**优化步骤**:
```
1. 使用更快的模型（Phi-3、Gemma）
2. 减少上下文长度
3. 启用GPU加速
4. 使用量化模型（Q4, Q8）
5. 考虑使用云端API
```

## 常见问题

### 本地模型vs云端API，如何选择?

```
本地模型适合:
✓ 隐私敏感数据
✓ 离线使用场景
✓ 长期大量使用（成本低）
✓ 实时响应要求

云端API适合:
✓ 对质量要求极高
✓ 使用量不大
✓ 无本地算力
✓ 需要最新功能
```

### 如何降低成本?

```
策略:
1. 本地模型为主，云端为辅
2. 缓存常见问题的答案
3. 优化提示词，减少Token消耗
4. 使用更便宜的模型（GPT-3.5、Claude Haiku）
5. 批处理请求
```

### 模型推荐?

```
个人使用:
- PC: Qwen2:7B (本地)
- 移动: MiniCPM-2B (本地)
- 云端: GPT-3.5-turbo (性价比)

专业用户:
- PC: LLaMA3:70B (本地) + Claude Opus (云端)
- 移动: Phi-3 Mini

企业:
- 自建: LLaMA3:70B 集群
- 云端: GPT-4 Turbo
```

## 未来功能

- [ ] 模型微调支持
- [ ] 多模态模型（图片理解）
- [ ] 语音模型集成
- [ ] 联邦学习
- [ ] 更多模型支持（Gemini、百川等）
