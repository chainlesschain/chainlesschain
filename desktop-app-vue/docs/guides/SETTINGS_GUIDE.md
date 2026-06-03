# 系统设置使用指南

## 概述

系统设置页面提供了统一的配置管理界面，允许您在应用内修改所有 `.env` 配置参数，无需手动编辑配置文件。

## 访问方式

在应用内导航到：**设置 → 系统设置**

或直接访问路由：`#/settings/system`

## 配置分类

### 1. 项目存储配置

配置项目文件的存储位置和同步策略。

**配置项**：
- **项目根目录**: 项目文件存储的本地根目录路径
  - 默认值: `项目根目录/data/projects`
  - 修改后需要重启应用生效

- **最大项目大小**: 单个项目允许的最大大小（MB）
  - 默认值: 1000 MB
  - 范围: 100-10000 MB

- **自动同步**: 是否自动同步项目到后端服务器
  - 默认值: 启用

- **同步间隔**: 自动同步的时间间隔（秒）
  - 默认值: 300 秒（5 分钟）
  - 范围: 60-3600 秒

### 2. AI 模型配置

配置 LLM（大语言模型）服务提供商和相关参数。

**支持的提供商**：

#### Ollama（本地）
- **服务地址**: Ollama 服务的 HTTP 地址
  - 默认值: `http://localhost:11434`
- **模型名称**: 使用的模型名称
  - 默认值: `qwen2:7b`
  - 其他选项: `llama2`, `mistral`, `codellama` 等

#### OpenAI
- **API Key**: OpenAI API 密钥
- **API 地址**: OpenAI API 端点地址
  - 默认值: `https://api.openai.com/v1`
- **模型**: 使用的模型
  - 默认值: `gpt-3.5-turbo`
  - 其他选项: `gpt-4`, `gpt-4-turbo` 等

#### 火山引擎（豆包）⭐ 推荐
- **API Key**: 火山引擎 API 密钥
- **模型**: 使用的模型
  - 默认值: `doubao-seed-1-6-lite-251015`
  - 其他选项: `doubao-pro-32k`, `doubao-lite-4k` 等

#### 阿里通义千问
- **API Key**: 阿里云 DashScope API 密钥
- **模型**:
  - `qwen-turbo`: 快速推理（推荐）
  - `qwen-plus`: 平衡性能
  - `qwen-max`: 最强性能

#### 智谱 AI
- **API Key**: 智谱 AI API 密钥
- **模型**:
  - 默认值: `glm-4`
  - 其他选项: `glm-3-turbo`, `chatglm-pro` 等

#### DeepSeek
- **API Key**: DeepSeek API 密钥
- **模型**:
  - 默认值: `deepseek-chat`
  - 其他选项: `deepseek-coder` 等

### 3. 向量数据库配置

配置 Qdrant 向量数据库，用于知识库的语义搜索。

**配置项**：
- **服务地址**: Qdrant 服务的 HTTP 地址
  - 默认值: `http://localhost:6333`

- **端口**: Qdrant 服务端口
  - 默认值: 6333

- **集合名称**: 向量集合的名称
  - 默认值: `chainlesschain_vectors`

- **Embedding 模型**: 用于生成向量的模型
  - 默认值: `bge-base-zh-v1.5`

- **向量维度**: 向量的维度
  - 默认值: 768
  - 范围: 128-2048

### 4. Git 同步配置

配置 Git 版本控制和自动同步功能。

**配置项**：
- **启用 Git 同步**: 是否启用 Git 功能
  - 默认值: 禁用

- **自动同步**: 自动提交和推送更改
  - 默认值: 禁用

- **同步间隔**: 自动同步的时间间隔（秒）
  - 默认值: 300 秒

- **用户名**: Git 提交的用户名
  - 默认值: `ChainlessChain`

- **邮箱**: Git 提交的邮箱
  - 默认值: `bot@chainlesschain.com`

- **远程仓库 URL**: Git 远程仓库地址
  - 示例: `https://github.com/username/repo.git`

### 5. 后端服务配置

配置后端微服务的地址。

**配置项**：
- **项目服务**: 项目管理服务地址
  - 默认值: `http://localhost:9090`

- **AI 服务**: AI 推理服务地址
  - 默认值: `http://localhost:8001`

### 6. 安全配置

配置数据库加密等安全相关参数。

**配置项**：
- **SQLCipher 密钥**: 数据库加密密钥
  - 留空使用默认密钥
  - ⚠️ **警告**: 修改加密密钥后，旧数据将无法访问！

## 操作说明

### 保存配置

点击 **"保存配置"** 按钮保存所有修改。

- ✅ 配置会立即保存到本地配置文件
- ⚠️ 部分配置（如项目根目录）需要重启应用才能生效
- 💾 配置文件位置: `%AppData%/chainlesschain-desktop-vue/config/app-config.json`

### 重置为默认值

点击 **"重置为默认值"** 按钮将所有配置恢复为出厂设置。

- ⚠️ 此操作不可撤销
- 💡 重置后会丢失所有自定义配置

### 导出为 .env 文件

点击 **"导出为 .env 文件"** 按钮将当前配置导出为 `.env` 文件。

- 📄 导出位置: `desktop-app-vue/.env`
- 💡 便于备份和分享配置

## 配置文件优先级

配置的加载顺序（后者覆盖前者）：

1. **默认配置**: 应用内置的默认值
2. **环境变量**: `.env` 文件或系统环境变量
3. **配置文件**: `app-config.json` 中保存的用户配置

## 最佳实践

### 本地开发

```env
# 使用本地 Ollama
LLM_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2:7b

# 本地向量数据库
QDRANT_HOST=http://localhost:6333

# 本地项目存储
PROJECTS_ROOT_PATH=C:/code/chainlesschain/data/projects
```

### 生产环境

```env
# 使用云端 AI（推荐火山引擎）
LLM_PROVIDER=volcengine
VOLCENGINE_API_KEY=your_api_key_here
VOLCENGINE_MODEL=doubao-seed-1-6-lite-251015

# 云端向量数据库
QDRANT_HOST=http://your-server:6333

# 云端项目存储
PROJECTS_ROOT_PATH=/data/projects
```

### 团队协作

```env
# 启用 Git 同步
GIT_ENABLED=true
GIT_AUTO_SYNC=true
GIT_REMOTE_URL=https://github.com/your-org/knowledge-base.git
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=your.email@company.com
```

## 故障排除

### 配置不生效

1. 确认已点击"保存配置"按钮
2. 重启应用
3. 检查配置文件是否正确保存：
   - Windows: `%AppData%\chainlesschain-desktop-vue\config\app-config.json`
   - macOS: `~/Library/Application Support/chainlesschain-desktop-vue/config/app-config.json`
   - Linux: `~/.config/chainlesschain-desktop-vue/config/app-config.json`

### LLM 服务无法连接

1. 确认服务地址和端口正确
2. 检查服务是否正在运行
3. 测试网络连通性：
   ```bash
   # Ollama
   curl http://localhost:11434/api/tags

   # Qdrant
   curl http://localhost:6333/collections
   ```

### 项目路径错误

1. 确保项目根目录路径存在
2. 检查路径权限（需要读写权限）
3. Windows 路径使用正斜杠 `/` 或双反斜杠 `\\`
   - ✅ 正确: `C:/code/projects` 或 `C:\\code\\projects`
   - ❌ 错误: `C:\code\projects`

## 技术细节

### 配置管理架构

```
AppConfig (主进程)
├── 默认配置 (getDefaultConfig)
├── 环境变量 (.env)
└── 用户配置 (app-config.json)
    ↓
IPC 通信
    ↓
Preload API
    ↓
Vue 组件 (SystemSettings.vue)
```

### API 接口

前端可用的配置 API：

```javascript
// 获取所有配置
const config = await window.electronAPI.config.getAll();

// 获取特定分类配置
const llmConfig = await window.electronAPI.config.get('llm');

// 更新配置
await window.electronAPI.config.update({
  llm: { provider: 'volcengine' }
});

// 重置配置
await window.electronAPI.config.reset();

// 导出 .env
await window.electronAPI.config.exportEnv('/path/to/.env');
```

## 相关文档

- [快速开始指南](./QUICK_START.md)
- [环境变量配置](./.env.example)
- [项目配置说明](./CLAUDE.md)

## 反馈与支持

如遇到问题或有改进建议，请通过以下方式反馈：

- GitHub Issues: https://github.com/chainlesschain/chainlesschain/issues
- 项目文档: ./docs/

---

**最后更新**: 2025-12-22
**版本**: v0.16.0
