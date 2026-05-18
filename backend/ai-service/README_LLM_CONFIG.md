# LLM配置指南

## 概述

ChainlessChain AI服务默认优先使用**云LLM**（阿里云DashScope通义千问），如果未配置API Key则自动回退到本地Ollama。

## 智能Fallback机制

1. **优先使用云LLM**：默认使用`dashscope`（通义千问）
2. **自动回退**：如果云LLM的API Key未配置或为空，自动切换到本地Ollama
3. **确保可用**：无论云LLM是否配置，服务始终可用

## 配置步骤

### 1. 编辑`.env`文件

在`backend/ai-service/.env`文件中配置：

```bash
# 选择LLM提供商（dashscope推荐）
LLM_PROVIDER=dashscope
LLM_MODEL=qwen-turbo

# 配置阿里云DashScope API Key
DASHSCOPE_API_KEY=sk-your-api-key-here
```

### 2. 获取API Key

#### 阿里云DashScope（推荐）
- 访问：https://dashscope.console.aliyun.com/
- 注册并创建API Key
- 免费额度：每月300万tokens

#### 其他支持的云LLM提供商

| 提供商 | 环境变量 | 获取地址 |
|--------|----------|----------|
| OpenAI | `OPENAI_API_KEY` | https://platform.openai.com/ |
| 智谱AI | `ZHIPU_API_KEY` | https://open.bigmodel.cn/ |
| 百度千帆 | `QIANFAN_API_KEY` | https://cloud.baidu.com/product/wenxinworkshop |
| 火山引擎 | `VOLCENGINE_API_KEY` | https://console.volcengine.com/ |
| 腾讯混元 | `HUNYUAN_API_KEY` | https://cloud.tencent.com/product/hunyuan |
| 讯飞星火 | `SPARK_API_KEY` | https://xinghuo.xfyun.cn/ |
| MiniMax | `MINIMAX_API_KEY` | https://api.minimax.chat/ |
| DeepSeek | `DEEPSEEK_API_KEY` | https://platform.deepseek.com/ |

### 3. 重启服务

```bash
# 重启AI服务容器
docker-compose restart ai-service

# 或重启所有服务
docker-compose down
docker-compose up -d
```

## 配置示例

### 使用阿里云DashScope
```bash
LLM_PROVIDER=dashscope
LLM_MODEL=qwen-turbo
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxx
```

### 使用智谱AI
```bash
LLM_PROVIDER=zhipu
LLM_MODEL=glm-4
ZHIPU_API_KEY=xxxxxxxxxxxxx
```

### 使用OpenAI
```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
```

### 回退到本地Ollama
```bash
LLM_PROVIDER=ollama
LLM_MODEL=qwen2:7b
# 不需要API Key
```

## 验证配置

### 1. 查看服务日志
```bash
docker-compose logs -f ai-service
```

如果看到类似日志，说明自动回退成功：
```
WARNING: LLM_PROVIDER设置为'dashscope'，但未配置API Key，自动回退到Ollama本地LLM
```

### 2. 测试API
```bash
curl -X POST http://localhost:8001/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{"user_prompt": "创建一个简单的待办事项列表", "project_type": "web"}'
```

## 常见问题

### Q: 为什么推荐使用DashScope？
A:
- 国内访问速度快
- 有免费额度
- 支持中文效果好
- API稳定可靠

### Q: 如何查看当前使用的LLM？
A: 查看AI服务日志，会显示当前使用的提供商和模型

### Q: 云LLM和本地Ollama的区别？
A:
- **云LLM**：速度快、效果好、需要网络、需要API Key
- **本地Ollama**：离线可用、免费、需要下载模型、速度取决于硬件

### Q: 如何只使用本地Ollama？
A: 将`.env`中的`LLM_PROVIDER`设置为`ollama`

### Q: API Key如何保密？
A: `.env`文件已在`.gitignore`中，不会被提交到Git仓库

## 性能建议

1. **生产环境**：推荐使用云LLM，速度快效果好
2. **开发环境**：可以使用本地Ollama节省成本
3. **离线场景**：使用本地Ollama
4. **混合使用**：配置多个API Key，根据需要切换

## 技术支持

如有问题，请参考：
- 项目主README：`../../README.md`
- 快速开始：`../../QUICK_START.md`
- 系统设计文档：`../../系统设计_个人移动AI管理系统.md`
