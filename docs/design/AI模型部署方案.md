# AI模型部署方案

> 本文档是 [系统设计主文档](系统设计_主文档.md) 的子文档，详细描述Ollama和云端LLM的模型部署方案。

---

## 五、AI模型部署方案

### 5.1 模型选型

#### 5.1.1 LLM (大语言模型)

| 设备类型     | 推荐模型     | 参数量 | 内存需求        | 性能         |
| ------------ | ------------ | ------ | --------------- | ------------ |
| **高性能PC** | LLaMA3-70B   | 70B    | 64GB RAM + 显卡 | 接近GPT-3.5  |
| **普通PC**   | Qwen2-7B     | 7B     | 16GB RAM        | 日常使用足够 |
| **低配PC**   | Phi-3-mini   | 3.8B   | 8GB RAM         | 轻量但实用   |
| **旗舰手机** | MiniCPM-2B   | 2.4B   | 6GB RAM         | 移动端最优   |
| **中端手机** | Gemma-2B     | 2B     | 4GB RAM         | 速度快       |
| **云端API**  | GPT-4/Claude | -      | 无需本地资源    | 最强性能     |

#### 5.1.2 Embedding模型 (向量化)

| 模型                   | 维度 | 大小  | 语言支持 | 用途           |
| ---------------------- | ---- | ----- | -------- | -------------- |
| bge-large-zh-v1.5      | 1024 | 1.3GB | 中英文   | PC端,高精度    |
| bge-base-zh-v1.5       | 768  | 400MB | 中英文   | 平衡性能和精度 |
| bge-small-zh-v1.5      | 512  | 95MB  | 中英文   | 移动端,轻量    |
| text-embedding-ada-002 | 1536 | API   | 多语言   | 云端,最强效果  |

#### 5.1.3 向量数据库

| 数据库       | 类型     | 优点            | 缺点                | 适用设备    |
| ------------ | -------- | --------------- | ------------------- | ----------- |
| **ChromaDB** | 嵌入式   | 简单,自带持久化 | 性能一般            | PC和移动端  |
| **Qdrant**   | 独立服务 | 高性能,功能丰富 | 需要单独部署        | PC (Docker) |
| **Milvus**   | 分布式   | 企业级,可扩展   | 复杂,资源占用大     | 服务器      |
| **FAISS**    | 库       | 超高性能        | 无持久化,需自己封装 | 高级用户    |

### 5.2 PC端部署方案

#### 5.2.1 Docker Compose配置

```yaml
version: "3.8"

services:
  # Ollama - LLM推理引擎
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
              capabilities: [gpu] # 如果有NVIDIA显卡

  # Qdrant - 向量数据库
  qdrant:
    image: qdrant/qdrant:latest
    container_name: chainlesschain-vectordb
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ./qdrant_data:/qdrant/storage

  # AnythingLLM - RAG问答系统
  anythingllm:
    image: mintplexlabs/anythingllm:latest
    container_name: chainlesschain-rag
    ports:
      - "3001:3001"
    volumes:
      - ./anythingllm_data:/app/server/storage
    environment:
      - LLM_PROVIDER=ollama
      - OLLAMA_BASE_URL=http://ollama:11434
      - VECTOR_DB=qdrant
      - QDRANT_ENDPOINT=http://qdrant:6333
      - EMBEDDING_ENGINE=native # 使用内置Embedding

  # Git服务器 (可选,自托管)
  gitea:
    image: gitea/gitea:latest
    container_name: chainlesschain-git
    ports:
      - "3000:3000"
      - "2222:22"
    volumes:
      - ./gitea_data:/data
    environment:
      - USER_UID=1000
      - USER_GID=1000
      - GITEA__database__DB_TYPE=sqlite3
```

**一键启动脚本**:

```bash
#!/bin/bash
# setup_pc.sh

echo "正在启动Chainlesschain AI系统..."

# 1. 启动Docker容器
docker-compose up -d

# 2. 等待服务就绪
echo "等待服务启动..."
sleep 10

# 3. 下载LLM模型
echo "下载语言模型 (首次运行需要几分钟)..."
docker exec chainlesschain-llm ollama pull qwen2:7b

# 4. 下载Embedding模型
docker exec chainlesschain-llm ollama pull nomic-embed-text

# 5. 创建向量数据库集合
curl -X PUT 'http://localhost:6333/collections/knowledge_base' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'

echo "✅ 系统启动完成!"
echo "LLM API: http://localhost:11434"
echo "向量数据库: http://localhost:6333"
echo "RAG问答: http://localhost:3001"
```

### 5.3 移动端部署方案

#### 5.3.1 Android集成

```kotlin
// 使用MLC LLM在Android上运行本地模型
class LocalLLM(context: Context) {
    private val mlcEngine = MLCEngine(context)

    fun initialize() {
        // 下载并加载MiniCPM-2B模型
        val modelPath = downloadModel("MiniCPM-2B-Q4")  // 量化到4bit
        mlcEngine.loadModel(modelPath)
    }

    suspend fun chat(prompt: String, history: List<Message>): String {
        return mlcEngine.generate(prompt, maxTokens = 512)
    }
}

// Embedding模型
class LocalEmbedding(context: Context) {
    private val tfLite = Interpreter(loadModelFile("bge-small-zh-v1.5.tflite"))

    fun embed(text: String): FloatArray {
        // 分词
        val tokens = tokenizer.encode(text)
        // 推理
        val embedding = FloatArray(512)
        tfLite.run(tokens, embedding)
        return embedding
    }
}
```

#### 5.3.2 iOS集成

```swift
// 使用Core ML运行本地模型
class LocalLLM {
    private var model: MLModel?

    func initialize() {
        // 加载编译好的.mlpackage模型
        let modelURL = Bundle.main.url(forResource: "MiniCPM-2B", withExtension: "mlpackage")!
        model = try? MLModel(contentsOf: modelURL)
    }

    func generate(prompt: String) async -> String {
        // 使用Core ML推理
        let input = MLDictionary(["input_text": prompt])
        let output = try? model?.prediction(from: input)
        return output?["generated_text"] as? String ?? ""
    }
}
```

### 5.4 混合部署策略

**智能路由**:

```python
class AIRouter:
    def __init__(self):
        self.pc_llm_available = check_pc_api("http://192.168.1.100:11434")
        self.mobile_llm_available = check_mobile_model()
        self.cloud_api_key = get_api_key("openai")

    def route_request(self, prompt: str, context_length: int,
                      quality_required: str) -> str:
        """
        智能选择使用哪个模型
        """
        # 1. 长上下文 -> 云端API
        if context_length > 8000:
            return self.call_cloud_api(prompt)

        # 2. 高质量要求 + 在家 -> PC端模型
        if quality_required == "high" and self.pc_llm_available:
            return self.call_pc_llm(prompt)

        # 3. 快速响应 + 移动场景 -> 本地模型
        if quality_required == "fast" and self.mobile_llm_available:
            return self.call_mobile_llm(prompt)

        # 4. 默认 -> 云端API (如果有密钥)
        if self.cloud_api_key:
            return self.call_cloud_api(prompt)

        # 5. 降级到任何可用的模型
        if self.mobile_llm_available:
            return self.call_mobile_llm(prompt)

        return "抱歉,当前没有可用的AI模型"
```


## 实现状态 (v0.20.0)

**LLM支持**:
- **Ollama** - 本地部署(qwen2:7b等)
- **14+云端API** - Anthropic, OpenAI, Dashscope, Zhipuai, Volcengine, Qianfan等

**Embedding**:
- **ChromaDB 3.1.8** - 向量数据库
- **@chroma-core/default-embed 0.1.9** - 嵌入模型

**完成度**: 100% ✅ (本地+云端混合部署)

