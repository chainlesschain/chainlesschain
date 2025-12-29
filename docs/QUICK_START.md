# ChainlessChain 快速开始指南

**版本**: v0.17.0
**更新时间**: 2025-12-29

---

## 🚀 5分钟快速体验

### 最小化启动 (仅桌面应用)

```bash
# 1. 安装依赖
cd desktop-app-vue
npm install

# 2. 启动应用
npm run dev
```

✅ 应用将在 `http://localhost:5173` 启动并自动打开Electron窗口
✅ 默认PIN码: `123456`

---

## 📦 完整安装指南

### 环境要求

| 软件 | 最低版本 | 推荐版本 | 用途 |
|------|----------|----------|------|
| Node.js | 18.0.0 | 20.x | 运行环境 |
| npm | 9.0.0 | 10.x | 包管理器 |
| Python | 3.10 | 3.11 | AI服务(可选) |
| Java | 17 | 17 | 后端服务(可选) |
| Docker | 20.x | 最新 | 容器服务(可选) |
| Git | 2.x | 最新 | 版本控制 |

### Step 1: 克隆仓库

```bash
git clone https://github.com/yourname/chainlesschain.git
cd chainlesschain
```

### Step 2: 安装依赖

```bash
# 根目录依赖
npm install

# 桌面应用依赖
cd desktop-app-vue
npm install
cd ..
```

### Step 3: 启动服务 (可选)

#### Option A: 仅桌面应用 (推荐新手)

```bash
cd desktop-app-vue
npm run dev
```

#### Option B: 完整服务 (包含后端)

**启动 Docker 服务**:
```bash
# 启动所有服务
npm run docker:up

# 查看日志
npm run docker:logs

# 拉取 LLM 模型
docker exec chainlesschain-ollama ollama pull qwen2:7b
```

**启动 AI 服务**:
```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

**启动 Project 服务**:
```bash
cd backend/project-service
mvn spring-boot:run
```

**启动桌面应用**:
```bash
cd desktop-app-vue
npm run dev
```

---

## 🎮 首次使用

### 1. 登录系统

- 默认PIN码: `123456`
- U盾模式: 模拟模式 (无需硬件)
- 点击"登录"按钮

### 2. 创建第一个项目

1. 点击顶部导航"项目"
2. 点击"新建项目"按钮
3. 填写项目名称和描述
4. 选择项目模板 (可选)
5. 点击"创建"

### 3. 添加知识条目

1. 在项目详情页，点击"新建笔记"
2. 输入标题和内容 (支持Markdown)
3. 添加标签 (可选)
4. 自动保存 (1秒防抖)

### 4. 使用AI助手

1. 点击右上角"AI助手"图标
2. 在聊天框输入问题
3. 查看AI回复 (基于当前项目上下文)

---

## 🔧 常用命令

### 桌面应用

```bash
cd desktop-app-vue

# 开发模式 (热重载)
npm run dev

# 构建生产版本
npm run build

# 打包为Windows安装程序
npm run make:win

# 运行测试
npm run test

# 数据库测试
npm run test:db

# U盾测试
npm run test:ukey
```

### Docker服务

```bash
# 启动服务
npm run docker:up

# 停止服务
npm run docker:down

# 查看日志
npm run docker:logs

# 重启服务
npm run docker:down && npm run docker:up
```

### 后端服务

```bash
# AI服务
cd backend/ai-service
uvicorn main:app --reload

# Project服务
cd backend/project-service
mvn spring-boot:run

# 社区论坛
cd community-forum/backend
mvn spring-boot:run
```

---

## 📂 数据存储位置

### Windows
```
C:\Users\{用户名}\AppData\Roaming\chainlesschain-desktop\
├── data\
│   └── chainlesschain.db  # 加密数据库
├── projects\              # Git仓库
├── logs\                  # 日志文件
└── config.json           # 配置文件
```

### macOS
```
~/Library/Application Support/chainlesschain-desktop/
```

### Linux
```
~/.config/chainlesschain-desktop/
```

---

## 🌐 服务端口

| 服务 | 端口 | 用途 |
|------|------|------|
| Vite Dev Server | 5173 | 前端开发服务器 |
| Ollama | 11434 | 本地LLM推理 |
| Qdrant | 6333 | 向量数据库 |
| PostgreSQL | 5432 | 关系数据库 |
| Redis | 6379 | 缓存服务 |
| AI Service | 8001 | AI微服务 |
| Project Service | 9090 | 项目微服务 |

---

## 🔍 功能快速索引

### 知识库管理
- **创建笔记**: 项目详情 → 新建笔记
- **导入文件**: 设置 → 导入 → 选择文件
- **搜索**: 顶部搜索框 → 输入关键词
- **标签管理**: 笔记详情 → 添加标签

### AI功能
- **AI聊天**: 右上角AI图标 → 输入问题
- **RAG检索**: 自动启用 (需后端服务)
- **代码生成**: AI聊天 → "生成代码..."
- **文档生成**: AI聊天 → "创建文档..."

### 项目管理
- **创建项目**: 项目列表 → 新建项目
- **Git同步**: 项目设置 → Git配置
- **任务管理**: 项目详情 → 任务标签
- **分享项目**: 项目详情 → 分享按钮

### 社交功能
- **添加好友**: 联系人 → 搜索用户
- **发布动态**: 社交 → 发布
- **聊天**: 好友列表 → 点击好友

### 交易系统
- **查看市场**: 交易中心 → 市场
- **创建订单**: 市场 → 发布
- **智能合约**: 交易中心 → 合约

---

## ⚙️ 配置说明

### LLM 配置

**本地 Ollama**:
```javascript
// desktop-app-vue/src/main/llm/llm-config.js
{
  provider: 'ollama',
  endpoint: 'http://localhost:11434',
  model: 'qwen2:7b'
}
```

**云端LLM** (14+ 提供商):
```javascript
{
  provider: 'alibaba',  // 阿里云通义千问
  apiKey: 'your-api-key',
  model: 'qwen-turbo'
}
```

支持的提供商:
- 阿里云 (Alibaba Qwen)
- 智谱 (Zhipu GLM)
- 百度 (Baidu Qianfan)
- OpenAI
- Azure OpenAI
- Claude (Anthropic)
- [更多...]

### 数据库配置

**加密密钥**:
```bash
# 使用U盾密钥 (推荐)
ukey: enabled

# 或使用密码
password: "your-secure-password"
```

### P2P 配置

```javascript
// desktop-app-vue/src/main/p2p/config.js
{
  bootstrap: [
    '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ'
  ],
  listen: ['/ip4/0.0.0.0/tcp/0', '/ip6/::/tcp/0']
}
```

---

## ❓ 常见问题

### Q1: 如何切换LLM模型?

**方法1: UI界面**
```
设置 → LLM配置 → 选择模型
```

**方法2: 命令行**
```bash
# 拉取新模型
docker exec chainlesschain-ollama ollama pull llama3:8b

# 代码中使用
const response = await llmManager.query('你好', [], 'llama3:8b');
```

### Q2: 数据库被锁定怎么办?

```bash
# 关闭应用
# 删除锁文件
rm data/chainlesschain.db-wal
rm data/chainlesschain.db-shm

# 重启应用
npm run dev
```

### Q3: 如何重置开发环境?

```bash
# 清理构建产物
npm run clean

# 停止Docker服务
npm run docker:down

# 删除数据库 (谨慎!)
rm -rf data/

# 重新安装依赖
npm install
cd desktop-app-vue && npm install

# 重启服务
npm run docker:up
npm run dev:desktop-vue
```

### Q4: Docker占用空间太大?

```bash
# 清理未使用的镜像
docker system prune -a

# 删除特定模型
docker exec chainlesschain-ollama ollama rm qwen2:7b

# 查看磁盘使用
docker system df
```

### Q5: 如何导入现有Markdown文件?

```
1. 打开应用 → 设置
2. 点击"导入" → "文件导入"
3. 选择Markdown文件或文件夹
4. 选择目标项目
5. 点击"导入"
```

---

## 🐛 故障排查

### 应用无法启动

**检查Node版本**:
```bash
node --version  # 应该 >= 18.0.0
npm --version   # 应该 >= 9.0.0
```

**清理缓存**:
```bash
rm -rf node_modules package-lock.json
npm install
```

### AI功能不可用

**检查Ollama服务**:
```bash
docker ps | grep ollama
curl http://localhost:11434/api/tags
```

**检查向量数据库**:
```bash
curl http://localhost:6333/collections
```

### Git同步失败

**检查Git配置**:
```bash
git config --global user.name
git config --global user.email
```

**检查仓库权限**:
```bash
cd projects/your-project
git remote -v
git status
```

---

## 📞 获取帮助

### 文档
- [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) - 项目概览
- [CURRENT_STATUS.md](./CURRENT_STATUS.md) - 当前状态
- [HOW_TO_RUN.md](./HOW_TO_RUN.md) - 详细运行指南
- [CLAUDE.md](../CLAUDE.md) - Claude Code 指南

### 社区
- **GitHub Issues**: https://github.com/yourname/chainlesschain/issues
- **Discord**: [加入社区](https://discord.gg/chainlesschain)
- **Email**: support@chainlesschain.org

---

## 🎉 下一步

恭喜你完成了ChainlessChain的快速开始！

**推荐学习路径**:
1. ✅ 完成快速开始
2. 📖 阅读 [系统设计文档](../系统设计_个人移动AI管理系统.md)
3. 🛠️ 探索 [开发指南](./DEVELOPMENT.md)
4. 🔧 查看 [API文档](./API.md) (如需开发)
5. 🤝 参与 [贡献](../CONTRIBUTING.md)

**常用功能教程**:
- [RAG检索使用指南](./RAG_FEATURES_OVERVIEW.md)
- [AI聊天增强功能](./AI_CHAT_ENHANCEMENTS.md)
- [编辑器使用指南](./ALL_EDITORS_README.md)
- [模板系统使用](./TEMPLATE_GUIDE.md)

---

**享受你的ChainlessChain之旅！** 🚀
