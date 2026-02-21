# AI模型配置

> **版本: v0.37.6 | 14+云LLM提供商 | 多模态支持 | 智能模型路由 | Context Engineering**

ChainlessChain 支持多种AI模型，包括本地部署和云端API，满足不同的使用需求。桌面端默认使用火山引擎豆包(VolcEngine Doubao)，支持 Ollama 本地模型自动回退，后端 AI Service 支持 14+ 云LLM提供商。

## 模型类型

### 1. LLM (大语言模型)

用于对话、推理和内容生成：
- **本地模型**: 隐私保护，无需联网
- **云端API**: 性能最强，需要费用

### 2. 多模态视觉模型

用于图像理解、视频理解、GUI自动化：
- **本地模型**: LLaVA (Ollama) - 离线视觉理解
- **云端API**: 豆包Vision、GPT-4V/4o、Claude Vision

### 3. Embedding模型

用于文本向量化，支持语义搜索：
- **本地模型**: 离线可用
- **云端API**: 更高精度

### 4. 图像/视频生成模型

用于AI创作：
- **图像生成**: 豆包Seedream、DALL-E
- **视频生成**: 豆包Seedance、PixelDance

### 5. RAG (检索增强生成)

结合向量检索和LLM，提供知识库问答。混合搜索引擎支持 Vector + BM25 + RRF融合。

## 支持的提供商总览

| 提供商 | 类型 | 桌面端 | 后端AI Service | Function Calling |
|--------|------|--------|---------------|-----------------|
| **Ollama** | 本地 | ✅ | ✅ | - |
| **火山引擎/豆包** | 云端 | ✅ (默认) | ✅ | ✅ |
| **OpenAI** | 云端 | ✅ | ✅ | ✅ |
| **Anthropic Claude** | 云端 | ✅ | - | - |
| **DeepSeek** | 云端 | ✅ | ✅ | ✅ |
| **通义千问 (DashScope)** | 云端 | - | ✅ | ✅ |
| **智谱AI (GLM)** | 云端 | - | ✅ | ✅ |
| **百度千帆** | 云端 | - | ✅ | - |
| **腾讯混元** | 云端 | - | ✅ | - |
| **讯飞星火** | 云端 | - | ✅ | - |
| **MiniMax** | 云端 | - | ✅ | - |
| **Moonshot/Kimi** | 云端 | ✅ (Custom) | - | - |
| **硅基流动 (SiliconFlow)** | 云端 | ✅ (Custom) | - | - |
| **零一万物 (Yi)** | 云端 | ✅ (Custom) | - | - |
| **LLaVA** | 本地 | ✅ | - | - |
| **自定义 (Custom)** | 云端 | ✅ | - | - |

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
ollama pull deepseek-coder:6.7b  # DeepSeek Coder
ollama pull llava:7b        # LLaVA视觉模型
```

#### 模型推荐

| 模型 | 参数量 | 内存需求 | 速度 | 质量 | 适用场景 |
|------|--------|----------|------|------|----------|
| Phi-3 Mini | 3.8B | 8GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 低配PC |
| Qwen2 | 7B | 16GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 通用推荐 |
| LLaMA3 | 8B | 16GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 通用推荐 |
| DeepSeek Coder | 6.7B | 16GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 代码生成 |
| Qwen2 | 14B | 32GB | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 高性能PC |
| LLaMA3 | 70B | 64GB+ GPU | ⭐⭐ | ⭐⭐⭐⭐⭐ | 专业用户 |
| LLaVA | 7B | 16GB | ⭐⭐⭐ | ⭐⭐⭐⭐ | 视觉理解 |

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

### 火山引擎/豆包（默认提供商）

ChainlessChain 桌面端默认使用火山引擎豆包系列模型。

#### 配置

```json
{
  "ai": {
    "llmProvider": "volcengine",
    "llmConfig": {
      "apiKey": "your-api-key",
      "baseURL": "https://ark.cn-beijing.volces.com/api/v3",
      "model": "doubao-seed-1-6-251015",
      "embeddingModel": "doubao-embedding-text-240715"
    }
  }
}
```

#### 文本生成模型

| 模型 | 上下文 | 费用 (输入/输出 ¥/百万tokens) | 特点 |
|------|--------|------|------|
| doubao-seed-1.6 | 256K | ¥0.8 / ¥2 | 主力模型，深度思考，推荐 |
| doubao-seed-1.6-thinking | 256K | ¥1 / ¥2.5 | 强制思考模式 |
| doubao-seed-1.6-flash | 256K | ¥0.4 / ¥1 | 快速响应，低延迟 |
| doubao-seed-1.6-lite | 256K | ¥0.3 / ¥0.8 | 最低成本 |
| doubao-pro-32k | 32K | ¥0.8 / ¥2 | 专业版 |
| doubao-seed-code | 128K | ¥0.6 / ¥1.8 | 代码生成专用 |

#### 视觉模型

| 模型 | 上下文 | 费用 | 特点 |
|------|--------|------|------|
| doubao-seed-1.6-vision | 256K | ¥2.6/¥7.8/百万tokens | 视觉深度思考，GUI Agent，推荐 |
| doubao-1.5-vision-pro | 128K | ¥2/¥6/百万tokens | 专业视觉理解 |
| doubao-1.5-vision-lite | 64K | ¥1/¥3/百万tokens | 轻量视觉 |
| doubao-1.5-ui-tars | - | ¥2/¥6/百万tokens | GUI自动化专用 |

#### 图像/视频生成模型

| 模型 | 费用 | 特点 |
|------|------|------|
| doubao-seedream-4.5 | ¥0.08-0.15/张 | 最新图像生成，推荐 |
| doubao-seedream-4.0 | ¥0.06-0.12/张 | 上一代图像生成 |
| doubao-seededit-3.0 | ¥0.05/张 | 图像编辑（背景移除、光线调整） |
| doubao-seedance-1.5-pro | ¥0.3/秒 | 专业视频生成，推荐 |
| doubao-pixeldance | ¥0.3/秒 | 高动态视频生成 |

#### Embedding模型

| 模型 | 维度 | 费用 | 特点 |
|------|------|------|------|
| doubao-embedding-large | 2048 | ¥0.2/百万tokens | 高精度检索，推荐 |
| doubao-embedding | 1024 | ¥0.15/百万tokens | 标准，中英文 |
| doubao-embedding-vision | 1536 | ¥0.3/百万tokens | 图像向量化 |

#### 专用模型

| 模型 | 费用 | 特点 |
|------|------|------|
| doubao-seed-translation | ¥0.5/¥1.5/百万tokens | 翻译专用 |
| doubao-seed3d-1.0 | ¥1.5/个 | 3D模型生成 |

---

### DeepSeek

#### 配置

```json
{
  "ai": {
    "llmProvider": "deepseek",
    "llmConfig": {
      "apiKey": "sk-...",
      "baseURL": "https://api.deepseek.com/v1",
      "model": "deepseek-chat"
    }
  }
}
```

#### 支持的模型

| 模型 | 费用 (输入/输出) | 上下文 | 特点 |
|------|------------------|--------|------|
| deepseek-chat | $0.14 / $0.28 / 1M tokens | 128K | 通用对话，性价比极高 |
| deepseek-coder | $0.14 / $0.28 / 1M tokens | 128K | 代码生成专用 |
| deepseek-reasoner | $0.55 / $2.19 / 1M tokens | 128K | 深度推理(R1) |

> DeepSeek 支持 Function Calling，桌面端和后端均已集成。

---

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
      "model": "gpt-4o",
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
| gpt-4o | $2.50 / $10 / 1M tokens | 128K | 最新旗舰，多模态 |
| gpt-4o-mini | $0.15 / $0.60 / 1M tokens | 128K | 快速便宜 |
| o1 | $15 / $60 / 1M tokens | 200K | 推理模型 |
| o3-mini | $1.10 / $4.40 / 1M tokens | 200K | 推理模型(轻量) |
| gpt-4-turbo | $10 / $30 / 1M tokens | 128K | 长上下文 |

---

### Anthropic Claude

#### 配置

```json
{
  "ai": {
    "llmProvider": "anthropic",
    "llmConfig": {
      "apiKey": "sk-ant-...",
      "model": "claude-sonnet-4-5-20250929",
      "temperature": 0.7,
      "maxTokens": 4096
    }
  }
}
```

#### 模型对比

| 模型 | 费用 | 上下文 | 特点 |
|------|------|--------|------|
| claude-opus-4-6 | $15 / $75 / 1M | 200K | 最强推理和编码 |
| claude-sonnet-4-5-20250929 | $3 / $15 / 1M | 200K | 平衡性能 |
| claude-haiku-4-5-20251001 | $0.80 / $4 / 1M | 200K | 快速便宜 |

---

### 国内大模型

#### 通义千问 (DashScope)

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

后端环境变量：
```bash
LLM_PROVIDER=dashscope
DASHSCOPE_API_KEY=sk-...
DASHSCOPE_MODEL=qwen-turbo
```

#### 智谱AI (ChatGLM)

```json
{
  "ai": {
    "llmProvider": "zhipu",
    "llmConfig": {
      "apiKey": "your-zhipu-key",
      "model": "glm-4"
    }
  }
}
```

后端环境变量：
```bash
LLM_PROVIDER=zhipu
ZHIPU_API_KEY=your-key
ZHIPU_MODEL=glm-4
```

> 智谱AI 支持 Function Calling。

#### 百度千帆 (文心一言)

```json
{
  "ai": {
    "llmProvider": "ernie",
    "llmConfig": {
      "apiKey": "your_key:secret",
      "model": "ERNIE-Bot-4"
    }
  }
}
```

后端环境变量：
```bash
LLM_PROVIDER=qianfan
QIANFAN_API_KEY=ak:sk
QIANFAN_MODEL=ERNIE-Bot-turbo
```

#### 腾讯混元

后端环境变量：
```bash
LLM_PROVIDER=hunyuan
HUNYUAN_API_KEY=your-key
HUNYUAN_MODEL=hunyuan-lite
```

> 使用 OpenAI 兼容接口 (`https://api.hunyuan.cloud.tencent.com/v1`)。

#### 讯飞星火

后端环境变量：
```bash
LLM_PROVIDER=spark
SPARK_API_KEY=app_id:api_key:api_secret
SPARK_MODEL=spark-lite
```

> 使用 OpenAI 兼容接口 (`https://spark-api-open.xf-yun.com/v1`)。

#### MiniMax

后端环境变量：
```bash
LLM_PROVIDER=minimax
MINIMAX_API_KEY=your-key
MINIMAX_MODEL=abab5.5-chat
```

> 使用 OpenAI 兼容接口 (`https://api.minimax.chat/v1`)。

#### Moonshot/Kimi

通过桌面端 Custom 提供商或 OpenAI 兼容接口接入：

```json
{
  "ai": {
    "llmProvider": "custom",
    "llmConfig": {
      "apiKey": "your-moonshot-key",
      "baseURL": "https://api.moonshot.cn/v1",
      "model": "moonshot-v1-8k",
      "name": "Moonshot"
    }
  }
}
```

支持模型：`moonshot-v1-8k`, `moonshot-v1-32k`, `moonshot-v1-128k`（长上下文）

#### 硅基流动 (SiliconFlow)

聚合多种开源模型，价格极低：

```json
{
  "ai": {
    "llmProvider": "custom",
    "llmConfig": {
      "apiKey": "your-siliconflow-key",
      "baseURL": "https://api.siliconflow.cn/v1",
      "model": "Qwen/Qwen2.5-72B-Instruct",
      "name": "SiliconFlow"
    }
  }
}
```

支持模型：`Qwen2-7B`, `Qwen2.5-72B`, `DeepSeek-V2.5` 等，费用低至 ¥0.7/百万tokens

#### 零一万物 (Yi)

```json
{
  "ai": {
    "llmProvider": "custom",
    "llmConfig": {
      "apiKey": "your-yi-key",
      "baseURL": "https://api.lingyiwanwu.com/v1",
      "model": "yi-large",
      "name": "Yi"
    }
  }
}
```

---

## 多模态视觉模型

### LLaVA 本地视觉模型

ChainlessChain 内置 LLaVA 客户端，支持本地多模态视觉理解：

```bash
# 安装LLaVA模型
ollama pull llava:7b
```

#### 配置

```json
{
  "ai": {
    "visionModel": "llava:7b",
    "visionConfig": {
      "baseURL": "http://localhost:11434",
      "timeout": 300000,
      "maxImageSize": 5242880
    }
  }
}
```

支持的图片格式：`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`

### 云端视觉模型

| 提供商 | 模型 | 特点 |
|--------|------|------|
| 火山引擎 | doubao-seed-1.6-vision | 视觉深度思考，GUI Agent |
| OpenAI | gpt-4o | 图像+视频理解 |
| Anthropic | claude-sonnet-4-5 | 图像理解 |

> Computer Use 功能集成了 Vision AI，支持自动截图+视觉分析实现GUI自动化。详见 [Computer Use →](/chainlesschain/computer-use)

---

## 智能模型路由

### Multi-Model Router 技能

ChainlessChain 内置智能模型路由技能 (`/multi-model-router`)，根据任务复杂度自动选择最优模型：

```
/multi-model-router --route fix a typo in README.md
→ Complexity: 1/10. Recommended: haiku (fastest, cheapest).

/multi-model-router --route refactor the entire authentication system across 15 files
→ Complexity: 9/10. Recommended: opus (strongest reasoning).
```

#### 模型能力矩阵

| 模型 | 推理 | 编码 | 速度 | 成本 | 适用场景 |
|------|------|------|------|------|----------|
| opus | 10 | 9 | 3 | 10 | 架构设计、复杂调试 |
| sonnet | 8 | 9 | 7 | 5 | 代码生成、重构 |
| haiku | 5 | 6 | 10 | 1 | 简单编辑、格式化 |
| gpt-4o | 9 | 8 | 6 | 7 | 通用任务 |
| gpt-4o-mini | 6 | 6 | 9 | 2 | 快速问答、翻译 |
| qwen2 | 7 | 7 | 8 | 0 | 本地推理(免费) |
| doubao-seed-1.6 | 8 | 8 | 7 | 2 | 通用+深度思考 |
| deepseek-chat | 8 | 9 | 7 | 1 | 代码+推理(极低成本) |

### 火山引擎智能模型选择器

桌面端内置 VolcEngine Model Selector，支持按任务类型自动选择豆包模型：

```javascript
// 任务类型 → 自动选择最优模型
const taskTypes = {
  chat: "doubao-seed-1.6",           // 通用对话
  long_context: "doubao-seed-1.6",   // 长文本处理
  complex_reasoning: "doubao-seed-1.6-thinking", // 复杂推理
  image_understanding: "doubao-seed-1.6-vision", // 图像理解
  code_writing: "doubao-seed-code",  // 代码编写
  fast_response: "doubao-seed-1.6-flash",        // 快速响应
  cost_effective: "doubao-seed-1.6-lite",         // 成本优化
  gui_automation: "doubao-1.5-ui-tars",           // GUI自动化
  translation: "doubao-seed-translation",          // 翻译
}
```

### 自动回退机制

后端 AI Service 具备智能 Fallback 机制：
- 当配置的云LLM API Key 未设置或为空时，自动回退到 Ollama 本地模型
- 确保服务始终可用，不因API配置缺失而中断

---

## Context Engineering (KV-Cache优化)

ChainlessChain 集成 Manus 风格的 Context Engineering 优化：

### 核心优化

- **静态/动态分离**: 将静态系统提示词放在对话开头，提高 KV-Cache 命中率 (60-85%)
- **工具定义序列化**: 按名称确定性排序，避免缓存失效
- **任务目标重述**: 在上下文中间重述目标，防止"迷失在中间"
- **错误历史追踪**: 从过去的错误中学习
- **可恢复压缩**: 保留引用以便后续恢复
- **Token估算**: 中英文自动检测

### 配置

```json
{
  "ai": {
    "contextEngineering": {
      "enabled": true,
      "kvCacheOptimization": true,
      "toolMasking": true,
      "taskTracking": true,
      "maxContextTokens": 128000
    }
  }
}
```

> 详见 Context Engineering IPC (17个处理器) 的完整配置。

---

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
      "device": "cuda"
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
      "model": "text-embedding-3-small",
      "dimensions": 1536
    }
  }
}
```

费用: $0.02 / 1M tokens (text-embedding-3-small)

#### 火山引擎 Embedding

```json
{
  "ai": {
    "embeddingProvider": "volcengine",
    "embeddingConfig": {
      "apiKey": "your-api-key",
      "model": "doubao-embedding-text-240715",
      "dimensions": 1024
    }
  }
}
```

费用: ¥0.15 / 百万tokens

---

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

ChainlessChain 内置 Hybrid Search Engine，支持 Vector + BM25 双路检索 + RRF融合：

```json
{
  "ragConfig": {
    "retrievalMode": "hybrid",
    "vectorWeight": 0.6,
    "keywordWeight": 0.4,
    "fusion": "rrf"
  }
}
```

- **Vector Search**: 语义相似度，通过 RAG Manager Embedding
- **BM25 Search**: Okapi BM25 算法，中英文分词器
- **RRF Fusion**: Reciprocal Rank Fusion 结果合并
- **性能**: <20ms 搜索延迟，并行执行

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

---

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

---

## LLM性能监控

ChainlessChain 内置 LLM Performance Dashboard（路由: `#/llm/performance`），提供全面的模型使用分析：

### 监控指标

- **Token 使用量**: 输入/输出 Token 统计，每日趋势
- **成本分析**: 各提供商费用追踪，成本预测
- **响应延迟**: 首 Token 时间、完整响应时间分布
- **缓存命中率**: Embedding 缓存、Response 缓存效果
- **模型对比**: 不同模型的性能/成本对比

### 配置

```json
{
  "ai": {
    "tokenTracking": {
      "enabled": true,
      "budgetAlert": {
        "daily": 100000,
        "monthly": 2000000
      }
    }
  }
}
```

> 详见 [LLM Performance Dashboard 文档](../features/LLM_PERFORMANCE_DASHBOARD.md)

---

## 性能优化

### 缓存策略

```json
{
  "ai": {
    "cacheEnabled": true,
    "cacheConfig": {
      "embeddingCache": true,
      "embeddingCacheTTL": 86400,
      "llmResponseCache": false,
      "maxCacheSize": 1000
    }
  }
}
```

Embedding 缓存使用 SQLite 存储，避免重复计算向量。

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
    "precision": "fp16"
  }
}
```

---

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

// 4. 使用Context Engineering优化KV-Cache命中率
// 静态内容前置，动态内容后置
```

### 成本对比

| 方案 | 月成本估算 | 适用场景 |
|------|-----------|----------|
| 纯本地 (Ollama) | ¥0 (电费) | 隐私优先、离线场景 |
| 豆包 Seed 1.6 Lite | ¥5-50 | 日常对话、性价比首选 |
| DeepSeek Chat | ¥5-30 | 代码+推理、极致性价比 |
| GPT-4o-mini | ¥10-100 | 通用任务 |
| GPT-4o / Claude Sonnet | ¥50-500 | 专业开发 |
| GPT-o1 / Claude Opus | ¥200-2000 | 复杂推理 |

---

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
- KV-Cache命中率

图表:
- 每日使用量趋势
- 不同模型的成本对比
- 响应速度分布
- 缓存命中率趋势
```

---

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
□ 提供商服务是否正常
```

### 智能Fallback失效

如果云端API失败但没有自动回退到Ollama：
```
检查:
1. Ollama服务是否运行: curl http://localhost:11434/api/tags
2. 本地模型是否已下载: ollama list
3. 配置中fallback是否启用
```

### 响应速度慢

**优化步骤**:
```
1. 使用更快的模型（doubao-seed-1.6-flash、Phi-3、Gemma）
2. 减少上下文长度
3. 启用GPU加速
4. 使用量化模型（Q4, Q8）
5. 启用Context Engineering的KV-Cache优化
6. 考虑使用云端API
```

---

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
2. 使用Multi-Model Router按任务复杂度路由
3. 缓存常见问题的答案（Embedding Cache + Response Cache）
4. 优化提示词，减少Token消耗
5. 使用Context Engineering提升KV-Cache命中率
6. 使用更便宜的模型（DeepSeek、豆包Lite、GPT-4o-mini、Haiku）
7. 批处理请求
```

### 模型推荐?

```
个人使用:
- PC: Qwen2:7B (本地) + 豆包Seed 1.6 Lite (云端，最低成本)
- 移动: MiniCPM-2B (本地)
- 云端首选: DeepSeek Chat (性价比之王)

专业开发者:
- PC: LLaMA3:70B (本地) + Claude Sonnet 4.5 (云端)
- 代码: DeepSeek Coder + doubao-seed-code
- 推理: DeepSeek Reasoner / Claude Opus 4.6

企业:
- 自建: LLaMA3:70B 集群
- 国内云端: 豆包Seed 1.6 (默认) / 通义千问Max
- 国际云端: GPT-4o / Claude Sonnet 4.5
- 合规审计: 配合Enterprise Audit系统
```

### 为什么默认使用火山引擎豆包?

```
原因:
1. 国内访问稳定，无需代理
2. 256K超长上下文窗口
3. 价格极具竞争力（¥0.3-2/百万tokens）
4. 支持深度思考模式
5. 完整多模态能力（视觉/图像/视频/3D）
6. 原生Function Calling支持
7. 中文能力优秀
```

---

## 已实现功能

- [x] 14+ 云LLM提供商集成（Ollama、OpenAI、Anthropic、DeepSeek、火山引擎、通义千问、智谱AI、百度千帆、腾讯混元、讯飞星火、MiniMax等）
- [x] 多模态视觉模型（LLaVA本地 + 豆包Vision + GPT-4V + Claude Vision）
- [x] 智能模型路由（Multi-Model Router技能）
- [x] Context Engineering KV-Cache优化
- [x] LLM Performance Dashboard（Token追踪、成本分析）
- [x] 混合检索引擎（Vector + BM25 + RRF融合）
- [x] Embedding缓存（SQLite存储）
- [x] 响应缓存和流式输出
- [x] 火山引擎智能模型选择器（按任务类型自动选择）
- [x] 图像生成（豆包Seedream 3.0/4.0/4.5）
- [x] 视频生成（豆包Seedance、PixelDance）
- [x] 图像编辑（豆包SeedEdit）
- [x] 3D模型生成（doubao-seed3d-1.0）
- [x] GUI自动化模型（doubao-1.5-ui-tars）
- [x] 翻译专用模型（doubao-seed-translation）
- [x] 智能Fallback（云端失败自动回退Ollama）
- [x] API Key加密存储（AES-256-GCM）

## 未来规划

- [ ] 模型微调支持（LoRA/QLoRA本地微调）
- [ ] 语音模型集成（Whisper语音识别 + TTS合成）
- [ ] 联邦学习（分布式模型训练，保护隐私）
- [ ] 更多模型支持（Google Gemini、Mistral、零一万物Yi等）
- [ ] 本地模型量化工具（一键GGUF/GPTQ量化）
- [ ] 模型性能基准测试（自动化评估框架）
- [ ] 多模型协作（Architect+Editor双模型模式）
- [ ] 长期记忆增强（结合Permanent Memory的个性化模型）
