# ChainlessChain 开发指南

本文档提供ChainlessChain项目的完整开发环境搭建和开发流程说明。

## 环境要求

### 必需软件
- **Node.js**: 18.0.0 或更高版本
- **npm**: 9.0.0 或更高版本
- **Docker Desktop**: 20.10+ (用于AI服务)
- **Git**: 2.30+ (用于版本控制)

### 推荐软件
- **VS Code**: 推荐的代码编辑器
- **Python**: 3.10+ (用于辅助脚本)

### 硬件要求
- **RAM**: 至少8GB (推荐16GB+)
- **存储**: 至少20GB可用空间
- **GPU**: 可选,NVIDIA GPU可加速AI推理

## 快速开始

### 1. 克隆项目
```bash
git clone https://github.com/yourname/chainlesschain.git
cd chainlesschain
```

### 2. 安装依赖
```bash
# 安装根依赖
npm install

# 安装PC端依赖
cd desktop-app
npm install
cd ..
```

### 3. 启动AI服务
**Windows:**
```bash
cd backend/docker
setup.bat
```

**Linux/Mac:**
```bash
cd backend/docker
chmod +x setup.sh
./setup.sh
```

等待模型下载完成(首次运行需要较长时间)。

### 4. 启动开发服务器
```bash
# 返回项目根目录
cd ../..

# 启动PC端开发服务器
npm run dev:desktop
```

应用程序将自动打开,默认PIN码为 `123456` (测试模式)。

## 项目结构详解

```
chainlesschain/
├── desktop-app/              # PC端桌面应用
│   ├── src/
│   │   ├── main/             # Electron主进程
│   │   │   ├── index.ts      # 主进程入口
│   │   │   ├── database.ts   # 数据库管理
│   │   │   ├── ukey.ts       # U盾管理 (模拟)
│   │   │   ├── git-sync.ts   # Git同步
│   │   │   └── llm-service.ts # LLM服务
│   │   │
│   │   ├── renderer/         # Electron渲染进程 (React)
│   │   │   ├── App.tsx       # React主组件
│   │   │   ├── pages/        # 页面组件
│   │   │   ├── components/   # 可复用组件
│   │   │   └── hooks/        # 自定义Hooks
│   │   │
│   │   └── shared/           # 共享代码
│   │       └── types.ts      # TypeScript类型定义
│   │
│   └── package.json
│
├── backend/                  # 后端服务
│   └── docker/
│       ├── docker-compose.yml  # Docker配置
│       ├── setup.sh          # Linux/Mac初始化脚本
│       └── setup.bat         # Windows初始化脚本
│
├── mobile-app/               # 移动端应用 (待开发)
│   ├── android/              # Android
│   └── ios/                  # iOS
│
├── docs/                     # 文档
│   ├── DEVELOPMENT.md        # 开发指南 (本文件)
│   └── 系统设计_个人移动AI管理系统.md
│
└── package.json              # Monorepo根配置
```

## 开发工作流

### 日常开发

1. **启动服务**
```bash
# 启动Docker服务 (如果未运行)
npm run docker:up

# 启动PC端开发服务器
npm run dev:desktop
```

2. **代码修改**
   - 修改代码后自动热重载
   - 主进程修改需手动重启

3. **调试**
   - 使用Chrome DevTools调试渲染进程
   - 使用VS Code调试主进程

### 常用命令

```bash
# 开发
npm run dev:desktop          # 启动PC端开发服务器
npm run dev:android          # 启动Android开发

# 构建
npm run build:desktop        # 构建PC端应用
npm run package              # 打包应用 (可执行文件)

# Docker管理
npm run docker:up            # 启动AI服务
npm run docker:down          # 停止AI服务
npm run docker:logs          # 查看Docker日志

# 代码质量
npm run lint                 # 代码检查
npm run format               # 代码格式化
npm run test                 # 运行测试

# 清理
npm run clean                # 清理构建产物
```

## 核心模块开发

### 1. 数据库开发 (database.ts)

**添加新表:**
```typescript
// desktop-app/src/main/database.ts
private createTables(): void {
  // 添加新表SQL
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS your_table (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}
```

**添加新方法:**
```typescript
export class Database {
  getYourData(): YourType[] {
    const stmt = this.db.prepare('SELECT * FROM your_table');
    return stmt.all() as YourType[];
  }
}
```

### 2. U盾开发 (ukey.ts)

**当前状态**: 模拟实现,用于开发测试

**集成真实U盾SDK**:
```typescript
// 1. 安装U盾厂商SDK (如飞天诚信)
// 2. 替换 UKeyManager 中的模拟实现
// 3. 实现真实的 detectUKey, verifyPIN, sign 等方法

import FTUKeySDK from 'ft-ukey-sdk'; // 示例

export class UKeyManager {
  private sdk: FTUKeySDK;

  async detectUKey(): Promise<boolean> {
    const devices = await this.sdk.enumerateDevices();
    return devices.length > 0;
  }

  async verifyPIN(pin: string): Promise<boolean> {
    return await this.sdk.verifyPIN(pin);
  }

  // ... 其他方法
}
```

### 3. LLM服务开发 (llm-service.ts)

**添加新模型:**
```typescript
// 下载新模型
await llmService.pullModel('llama3:8b');

// 使用新模型
const response = await llmService.query('你好', [], 'llama3:8b');
```

**实现RAG检索:**
```typescript
// 1. 向量化文档
const embedding = await llmService.embed('文档内容');

// 2. 存储到向量数据库 (Qdrant)
// 3. 检索相似文档
// 4. 作为context传入query
const context = ['相关文档1', '相关文档2'];
const answer = await llmService.query('问题', context);
```

### 4. Git同步开发 (git-sync.ts)

**配置远程仓库:**
```typescript
await gitSync.setRemote('origin', 'https://github.com/user/repo.git');
```

**实现自动同步:**
```typescript
// 定时同步
setInterval(async () => {
  await gitSync.sync();
}, 5 * 60 * 1000); // 每5分钟
```

## AI服务管理

### Ollama命令

```bash
# 进入容器
docker exec -it chainlesschain-ollama /bin/bash

# 拉取模型
ollama pull qwen2:7b
ollama pull llama3:8b
ollama pull nomic-embed-text

# 列出已安装模型
ollama list

# 运行模型
ollama run qwen2:7b

# 删除模型
ollama rm qwen2:7b
```

### Qdrant API

**创建集合:**
```bash
curl -X PUT 'http://localhost:6333/collections/my_collection' \
  -H 'Content-Type: application/json' \
  -d '{
    "vectors": {
      "size": 768,
      "distance": "Cosine"
    }
  }'
```

**插入向量:**
```bash
curl -X PUT 'http://localhost:6333/collections/my_collection/points' \
  -H 'Content-Type: application/json' \
  -d '{
    "points": [
      {
        "id": 1,
        "vector": [0.1, 0.2, ...],
        "payload": {"text": "文档内容"}
      }
    ]
  }'
```

**搜索:**
```bash
curl -X POST 'http://localhost:6333/collections/my_collection/points/search' \
  -H 'Content-Type: application/json' \
  -d '{
    "vector": [0.1, 0.2, ...],
    "limit": 10
  }'
```

## 测试

### 单元测试
```bash
# 运行所有测试
npm test

# 运行指定测试
npm test -- database.test.ts

# 观察模式
npm test -- --watch
```

### 集成测试
```bash
# E2E测试 (使用Playwright)
npm run test:e2e
```

## 调试技巧

### VS Code调试配置

创建 `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Electron: Main",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}/desktop-app",
      "runtimeExecutable": "${workspaceFolder}/desktop-app/node_modules/.bin/electron",
      "runtimeArgs": [".", "--remote-debugging-port=9223"],
      "outputCapture": "std"
    }
  ]
}
```

### 日志调试

```typescript
// 主进程日志
console.log('[Main]', 'message');

// 渲染进程日志
console.log('[Renderer]', 'message');

// 生产环境使用electron-log
import log from 'electron-log';
log.info('Application started');
```

## 性能优化

### 1. 数据库优化
- 使用索引加速查询
- 批量操作减少事务次数
- 定期VACUUM清理碎片

### 2. LLM优化
- 使用流式响应提升体验
- 缓存常见问答
- 量化模型减少内存占用

### 3. Git优化
- 使用shallow clone减少数据量
- 定期清理历史 (git gc)
- 使用LFS管理大文件

## 常见问题

### Q1: Ollama连接失败
**A**: 确保Docker服务已启动
```bash
docker ps  # 检查容器状态
docker-compose logs ollama  # 查看日志
```

### Q2: 模型下载慢
**A**: 配置镜像加速或手动下载
```bash
# 使用国内镜像
export OLLAMA_MIRROR=https://mirror.example.com
```

### Q3: 数据库加密失败
**A**: 生产环境需要配置真实的U盾,开发环境使用模拟密钥

### Q4: Git同步冲突
**A**: 手动解决冲突后重新提交
```bash
cd $APPDATA/chainlesschain/knowledge-repo
git status
# 解决冲突后
git add .
git commit -m "Resolve conflicts"
```

## 贡献代码

参见 [CONTRIBUTING.md](../CONTRIBUTING.md)

## 获取帮助

- **GitHub Issues**: https://github.com/yourname/chainlesschain/issues
- **讨论区**: https://github.com/yourname/chainlesschain/discussions
- **Email**: dev@chainlesschain.org

---

**Happy Coding! 🚀**
