# LLM默认配置修改说明

## 修改时间
2025-12-23

## 修改概述
将ChainlessChain AI服务的LLM默认配置从**本地Ollama**改为**云LLM（DashScope）**，并实现智能fallback机制。

## 修改内容

### 1. 根目录配置文件
**文件**: `.env.example`
- 新增`LLM_PROVIDER`和`LLM_MODEL`配置项
- 添加14+云LLM提供商的API Key配置说明
- 默认使用`dashscope`（阿里云通义千问）

### 2. AI服务配置
**文件**: `backend/ai-service/.env` (新建)
- 创建AI服务专用环境变量文件
- 配置默认LLM提供商为`dashscope`
- 配置所有支持的云LLM API Key占位符

### 3. LLM客户端代码
**文件**: `backend/ai-service/src/llm/llm_client.py`
- 更新`get_llm_client()`函数
- 添加智能Fallback机制：
  - 优先使用配置的云LLM
  - 如果API Key未配置或为空，自动回退到Ollama
  - 确保服务始终可用
- 更新默认值：`LLM_PROVIDER=dashscope`, `LLM_MODEL=qwen-turbo`

### 4. 引擎文件
**文件**:
- `backend/ai-service/src/engines/web_engine.py`
- `backend/ai-service/src/engines/doc_engine.py`
- `backend/ai-service/src/engines/data_engine.py`

**修改**: 更新所有引擎的默认LLM配置
- 从: `LLM_PROVIDER="ollama"`, `LLM_MODEL="qwen2:7b"`
- 到: `LLM_PROVIDER="dashscope"`, `LLM_MODEL="qwen-turbo"`

### 5. 主服务文件
**文件**: `backend/ai-service/main.py`
- 更新聊天接口的默认LLM配置
- 保持与其他模块一致的默认值

### 6. Docker配置
**文件**: `docker-compose.yml`
- 添加`env_file`配置，加载`backend/ai-service/.env`
- 在environment部分添加所有云LLM的API Key环境变量
- 添加说明注释

### 7. 配置文档
**文件**: `backend/ai-service/README_LLM_CONFIG.md` (新建)
- 详细说明LLM配置方法
- 列出所有支持的云LLM提供商
- 提供配置示例和常见问题解答

## 智能Fallback机制

### 工作流程
1. 系统启动时读取`LLM_PROVIDER`配置（默认`dashscope`）
2. 检查对应的API Key是否配置
3. 如果API Key存在且非空 → 使用云LLM
4. 如果API Key不存在或为空 → 自动回退到Ollama本地LLM
5. 记录警告日志，提示用户当前使用的LLM

### 日志示例
```
WARNING: LLM_PROVIDER设置为'dashscope'，但未配置API Key，自动回退到Ollama本地LLM
```

## 支持的云LLM提供商

| 提供商 | Provider | 默认模型 | API Key环境变量 |
|--------|----------|----------|----------------|
| 阿里云通义千问 | dashscope | qwen-turbo | DASHSCOPE_API_KEY |
| OpenAI | openai | gpt-4o-mini | OPENAI_API_KEY |
| 智谱AI | zhipu | glm-4 | ZHIPU_API_KEY |
| 火山引擎(豆包) | volcengine | doubao-pro-4k | VOLCENGINE_API_KEY |
| 百度千帆 | qianfan | ERNIE-Bot-turbo | QIANFAN_API_KEY |
| 腾讯混元 | hunyuan | hunyuan-lite | HUNYUAN_API_KEY |
| 讯飞星火 | spark | spark-lite | SPARK_API_KEY |
| MiniMax | minimax | abab5.5-chat | MINIMAX_API_KEY |
| DeepSeek | deepseek | deepseek-chat | DEEPSEEK_API_KEY |

## 如何使用

### 场景1：使用云LLM（推荐）
1. 编辑`backend/ai-service/.env`
2. 配置对应的API Key：
   ```bash
   DASHSCOPE_API_KEY=sk-your-api-key-here
   ```
3. 重启服务：
   ```bash
   docker-compose restart ai-service
   ```

### 场景2：继续使用本地Ollama
1. 编辑`backend/ai-service/.env`
2. 修改配置：
   ```bash
   LLM_PROVIDER=ollama
   LLM_MODEL=qwen2:7b
   ```
3. 重启服务

### 场景3：自动Fallback（当前默认行为）
- 不配置任何API Key
- 系统自动使用Ollama本地LLM
- 无需任何操作

## 验证方法

### 1. 查看日志
```bash
docker-compose logs -f ai-service
```

### 2. 测试API
```bash
curl -X POST http://localhost:8001/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{"user_prompt": "创建一个简单的待办事项列表", "project_type": "web"}'
```

## 优势

1. **更快的响应速度**：云LLM通常比本地Ollama快
2. **更好的生成质量**：云LLM模型更先进，效果更好
3. **无需下载模型**：不占用本地存储空间
4. **自动Fallback**：API Key未配置时自动使用本地LLM，确保服务可用
5. **灵活切换**：可随时在云LLM和本地LLM间切换

## 兼容性

- ✅ 向后兼容：不配置API Key时自动使用Ollama，行为与之前一致
- ✅ 配置灵活：支持14+种云LLM提供商
- ✅ 易于迁移：只需修改环境变量，无需改代码

## 注意事项

1. **API Key安全**：`.env`文件已在`.gitignore`中，不会泄露
2. **成本控制**：云LLM按使用量计费，建议设置预算提醒
3. **网络要求**：使用云LLM需要稳定的网络连接
4. **备份方案**：本地Ollama作为备份，确保离线可用

## 相关文档

- 配置指南：`backend/ai-service/README_LLM_CONFIG.md`
- 环境变量模板：`.env.example`
- 快速开始：`QUICK_START.md`
- 项目主文档：`README.md`

## 回滚方法

如需回滚到之前的配置（默认使用Ollama）：

```bash
# 编辑 backend/ai-service/.env
LLM_PROVIDER=ollama
LLM_MODEL=qwen2:7b

# 重启服务
docker-compose restart ai-service
```
