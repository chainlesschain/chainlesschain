# ChainlessChain 云端部署指南

本指南适用于**没有本地GPU**或**GPU算力不足**的用户，通过云端算力实现AI功能。

## 📋 目录

1. [部署模式对比](#部署模式对比)
2. [快速开始](#快速开始)
3. [云LLM API服务配置](#云llm-api服务配置)
4. [云GPU租用方案](#云gpu租用方案)
5. [成本对比](#成本对比)
6. [常见问题](#常见问题)

---

## 部署模式对比

| 模式 | 适用场景 | 优点 | 缺点 | 月成本估算 |
|------|---------|------|------|-----------|
| **本地GPU + Ollama** | 有高性能显卡 | 免费、隐私、无限调用 | 需要硬件投入 | ￥0（电费忽略） |
| **云LLM API** | 个人/小团队 | 简单、免维护、按需付费 | 依赖网络、有调用成本 | ￥2-50/月 |
| **云GPU租用** | 高频使用 | 性能好、成本可控 | 需要运维 | ￥50-300/月 |
| **混合模式** | 灵活需求 | 兼顾成本和性能 | 配置复杂 | ￥10-100/月 |

---

## 快速开始

### 方式1: 使用云LLM API（推荐新手）

#### Step 1: 选择云服务商

我们推荐以下服务商（按性价比排序）：

1. **硅基流动** - 性价比最高 ⭐⭐⭐⭐⭐
2. **阿里云通义千问** - 国内稳定 ⭐⭐⭐⭐
3. **零一万物** - 速度快 ⭐⭐⭐⭐
4. **智谱AI** - 新用户免费额度多 ⭐⭐⭐

#### Step 2: 获取API Key

以**硅基流动**为例：

```bash
# 1. 访问 https://siliconflow.cn/
# 2. 注册账号（支持微信/手机号）
# 3. 进入控制台 -> API密钥
# 4. 创建新密钥，复制保存
```

#### Step 3: 配置环境变量

```bash
# 复制云端配置模板
cp .env.cloud.example .env

# 编辑配置文件
vi .env  # 或使用任何文本编辑器
```

修改以下配置：

```bash
# 使用硅基流动
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxxxxxxxxxxxxx  # 替换为你的API Key
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=Qwen/Qwen2-7B-Instruct

# Embedding使用本地模型（无需GPU，CPU即可）
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=BAAI/bge-base-zh-v1.5
```

#### Step 4: 启动服务

```bash
# 使用云端模式启动
docker-compose -f docker-compose.cloud.yml up -d

# 查看日志
docker-compose -f docker-compose.cloud.yml logs -f ai-service
```

#### Step 5: 验证

```bash
# 测试AI Service健康状态
curl http://localhost:8001/health

# 测试意图识别
curl -X POST http://localhost:8001/api/intent/classify \
  -H "Content-Type: application/json" \
  -d '{"text": "帮我生成一个博客网站"}'
```

---

## 云LLM API服务配置

### 1. 硅基流动（SiliconFlow）⭐ 推荐

**优势**:
- 价格最低（Qwen2-7B仅￥0.0007/1K tokens）
- OpenAI兼容API，无需修改代码
- 支持多种开源模型

**配置**:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_siliconflow_key
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=Qwen/Qwen2-7B-Instruct  # 或 deepseek-ai/DeepSeek-V2.5
```

**获取Key**: https://siliconflow.cn/

**价格**:
- Qwen2-7B: ￥0.0007/1K tokens
- DeepSeek-V2.5: ￥0.0014/1K tokens

---

### 2. 阿里云通义千问（DashScope）

**优势**:
- 国内访问稳定
- 新用户有免费额度
- 企业级支持

**配置**:
```bash
LLM_PROVIDER=dashscope
DASHSCOPE_API_KEY=your_dashscope_key
DASHSCOPE_MODEL=qwen-turbo
```

**获取Key**: https://dashscope.aliyun.com/

**价格**:
- qwen-turbo: ￥0.008/1K tokens (免费100万tokens/月)
- qwen-plus: ￥0.02/1K tokens
- qwen-max: ￥0.12/1K tokens

**需要修改代码**:

在 `backend/ai-service/src/nlu/intent_classifier.py` 添加：

```python
# 在__init__中添加
if self.llm_provider == "dashscope":
    import dashscope
    dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

# 添加新方法
async def _call_dashscope(self, prompt: str) -> str:
    """调用DashScope API"""
    from dashscope import Generation

    response = Generation.call(
        model=self.model_name,
        messages=[
            {"role": "system", "content": "你是一个专业的意图识别助手"},
            {"role": "user", "content": prompt}
        ],
        temperature=0.1
    )
    return response.output.text
```

---

### 3. 零一万物（Yi API）

**配置**:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_lingyi_key
OPENAI_BASE_URL=https://api.lingyiwanwu.com/v1
LLM_MODEL=yi-large
```

**获取Key**: https://platform.lingyiwanwu.com/

**价格**: yi-large ￥0.02/1K tokens

---

### 4. 智谱AI (ChatGLM)

**配置**:
```bash
LLM_PROVIDER=zhipu
ZHIPU_API_KEY=your_zhipu_key
ZHIPU_MODEL=glm-4
```

**获取Key**: https://open.bigmodel.cn/

**价格**: 新用户有免费额度

---

## 云GPU租用方案

如果需要运行**本地Ollama**但本地无GPU，可以租用云GPU：

### 1. AutoDL（推荐）⭐⭐⭐⭐⭐

**官网**: https://www.autodl.com/

**优势**:
- 国内访问速度快
- 预装深度学习镜像
- 按小时计费，随时开关机

**配置推荐**:
- GPU: RTX 3090 (24GB)
- 费用: ￥1.5/小时
- 镜像: PyTorch 2.0 + Cuda 11.8

**部署步骤**:

```bash
# 1. 在AutoDL创建实例，选择RTX 3090

# 2. SSH登录到实例
ssh root@your_instance_ip

# 3. 安装Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 4. 启动Ollama
ollama serve

# 5. 拉取模型
ollama pull qwen2:7b

# 6. 在本地电脑配置环境变量
# .env文件中修改:
OLLAMA_HOST=http://your_instance_ip:11434
```

---

### 2. 矩池云

**官网**: https://matpool.com/

**费用**: RTX 3090 约￥1.2/小时

**特点**: 支持Jupyter，按需计费

---

### 3. 恒源云

**官网**: https://gpushare.com/

**费用**: RTX 3090 约￥1.8/小时

**特点**: 机器多，稳定性好

---

## 成本对比

### 典型使用场景成本估算

#### 场景1: 个人学习/测试（轻度使用）

**使用量**: 每天50次对话，每次平均500 tokens

**方案选择**: 阿里云通义千问 qwen-turbo

**计算**:
```
日调用量 = 50次 × 500 tokens = 25,000 tokens = 25K tokens
日成本 = 25K × ￥0.008/1K = ￥0.2/天
月成本 = ￥0.2 × 30 = ￥6/月
```

**免费额度**: 阿里云提供100万tokens/月，完全免费！

---

#### 场景2: 小团队使用（中度使用）

**使用量**: 每天200次对话，每次平均800 tokens

**方案选择**: 硅基流动 Qwen2-7B

**计算**:
```
日调用量 = 200次 × 800 tokens = 160,000 tokens = 160K tokens
日成本 = 160K × ￥0.0007/1K = ￥0.112/天
月成本 = ￥0.112 × 30 = ￥3.36/月
```

**结论**: 每月只需**￥3.36**！

---

#### 场景3: 高频使用（重度使用）

**使用量**: 每天1000次对话，每次平均1000 tokens

**方案A - 云API**: 硅基流动
```
日调用量 = 1000次 × 1000 tokens = 1,000K tokens
日成本 = 1000K × ￥0.0007/1K = ￥0.7/天
月成本 = ￥0.7 × 30 = ￥21/月
```

**方案B - 云GPU**: AutoDL RTX 3090
```
假设每天使用8小时
日成本 = ￥1.5/小时 × 8小时 = ￥12/天
月成本 = ￥12 × 30 = ￥360/月

但可以按需开关机:
工作日使用(22天): ￥12 × 22 = ￥264/月
```

**结论**:
- 低于1000次/天 → 用云API（￥21/月）
- 高于1000次/天 → 租GPU（￥264/月，但无限制）

---

### 成本对比表

| 使用场景 | 每日对话次数 | 推荐方案 | 月成本 |
|---------|------------|---------|--------|
| 个人测试 | 0-50 | 阿里云免费额度 | ￥0 |
| 轻度使用 | 50-100 | 硅基流动 | ￥2-5 |
| 中度使用 | 100-500 | 硅基流动 | ￥5-20 |
| 重度使用 | 500-1000 | 硅基流动 | ￥20-40 |
| 超高频 | 1000+ | 云GPU租用 | ￥100-300 |
| 企业级 | 大规模 | 阿里云企业版 | 定制化 |

---

## 常见问题

### Q1: 本地Embedding模型需要GPU吗？

**A**: 不需要！`bge-base-zh-v1.5` 在CPU上也能快速运行（每次推理约100ms）。配置：

```bash
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=BAAI/bge-base-zh-v1.5
```

首次启动会自动下载模型到 `~/.cache/huggingface/`

---

### Q2: 如何降低API调用成本？

**策略**:

1. **启用Redis缓存**: 相同问题不重复调用
2. **使用更小的模型**: qwen-turbo vs qwen-max
3. **优化Prompt**: 减少不必要的token消耗
4. **设置Token限制**:
   ```bash
   MAX_TOKENS=512  # 限制输出长度
   ```

---

### Q3: 云GPU和云API如何选择？

**选择云API的情况**:
- ✅ 调用频率低（<500次/天）
- ✅ 不想维护服务器
- ✅ 预算有限
- ✅ 对延迟不敏感（200-500ms可接受）

**选择云GPU的情况**:
- ✅ 高频调用（>1000次/天）
- ✅ 需要定制模型
- ✅ 数据隐私要求高
- ✅ 需要低延迟（<100ms）

---

### Q4: 免费额度用完了怎么办？

**方案**:

1. **多账号轮换**: 使用多个云服务商的免费额度
2. **切换到更便宜的服务**: 硅基流动￥0.0007/1K
3. **优化调用策略**: 启用缓存、减少重复调用
4. **按需付费**: 成本其实很低（每月几元到几十元）

---

### Q5: 如何监控API调用成本？

**方法**:

1. **在云服务控制台查看**: 大部分云服务商提供用量统计
2. **自建监控**:
   ```python
   # 在ai-service中添加成本跟踪
   import redis

   def track_usage(tokens, cost):
       redis_client.hincrby("usage:daily", "tokens", tokens)
       redis_client.hincrbyfloat("usage:daily", "cost", cost)
   ```
3. **设置预算告警**: 在云服务控制台设置费用告警

---

### Q6: 网络访问不了OpenAI怎么办？

**方案**:

1. **使用国内服务商**: 阿里云、智谱、硅基流动等
2. **使用代理**:
   ```bash
   HTTP_PROXY=http://your_proxy:7890
   HTTPS_PROXY=http://your_proxy:7890
   ```
3. **使用中转API**: 一些服务提供国内可访问的OpenAI API中转

---

## 推荐配置方案

### 新手入门方案 🌟
```bash
# .env配置
LLM_PROVIDER=dashscope
DASHSCOPE_API_KEY=your_key
DASHSCOPE_MODEL=qwen-turbo
EMBEDDING_PROVIDER=local

# 月成本: ￥0（免费额度内）
```

### 性价比方案 💰
```bash
# .env配置
LLM_PROVIDER=openai
OPENAI_API_KEY=your_siliconflow_key
OPENAI_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=Qwen/Qwen2-7B-Instruct
EMBEDDING_PROVIDER=local

# 月成本: ￥2-20
```

### 企业生产方案 🏢
```bash
# 方案A: 云API高可用
LLM_PROVIDER=dashscope
DASHSCOPE_MODEL=qwen-max
# 备用: OpenAI GPT-4

# 方案B: 自建GPU集群
# 租用多台云GPU，部署Ollama集群
# 配合负载均衡

# 月成本: ￥500-2000+
```

---

## 总结

对于没有本地GPU的用户：

1. **优先推荐**: 硅基流动API（性价比最高）
2. **备选方案**: 阿里云通义千问（免费额度）
3. **高频用户**: 租用AutoDL云GPU
4. **企业用户**: 阿里云企业版或自建GPU集群

**最低成本可以做到每月￥0-5元！** 🎉
