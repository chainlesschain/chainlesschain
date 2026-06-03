# 快速开始

本指南将帮助您在5分钟内快速部署和运行ChainlessChain系统。

## 一键安装（推荐）

使用 CLI 命令行工具，一条命令即可完成安装和配置：

```bash
npm install -g chainlesschain
chainlesschain setup
chainlesschain start
```

CLI 工具会自动检测环境、下载桌面应用、配置 LLM 提供商。详细用法请参考 [CLI 命令行工具](/chainlesschain/cli)。

## 前置要求

在开始之前，请确保您的系统已安装以下软件：

### ChainlessChain 个人AI系统

- **Node.js**: 22.12.0+ (推荐使用LTS版本)
- **Docker Desktop**: 用于运行后端服务 (PostgreSQL, Redis, Ollama等)（可选）
- **npm**: 10.0.0+ (Node.js 包管理器)

### U盾/SIMKey厂家管理系统

- **Docker Desktop**: Windows/Mac用户
- **Docker + Docker Compose**: Linux用户

## 安装 ChainlessChain 个人AI系统

### 1. 克隆项目

```bash
# 克隆主仓库
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

### 2. 安装依赖

```bash
# 安装所有依赖
npm install
```

### 3. 启动后端服务

使用Docker Compose启动所有后端服务（MySQL、Redis、Ollama等）：

```bash
cd backend/docker
docker-compose up -d
```

等待所有服务启动完成（约30秒）。

### 4. 启动PC端应用

```bash
# 回到项目根目录
cd ../..

# 启动桌面应用
npm run dev:desktop
```

应用会自动打开。首次启动时会进行初始化配置。

### 5. 启动移动端（可选）

#### Android

```bash
# 启动Android开发服务器
npm run dev:android

# 在Android Studio中打开项目
# File -> Open -> chainlesschain/android
# 点击Run按钮运行到设备或模拟器
```

#### iOS

```bash
# 安装CocoaPods依赖
cd ios
pod install
cd ..

# 启动iOS开发服务器
npm run dev:ios

# 在Xcode中打开项目
# File -> Open -> chainlesschain/ios/ChainlessChain.xcworkspace
# 点击Run按钮运行到设备或模拟器
```

### 6. 初始配置

首次启动时，您需要：

1. **创建或导入U盾/SIMKey**
   - 选择设备类型（U盾或SIMKey）
   - 输入激活码（如果有）
   - 设置PIN码

2. **配置AI模型**
   - 选择AI模型（Ollama、LLaMA、Qwen等）
   - 配置模型参数
   - 测试AI连接

3. **设置同步方式**
   - Git仓库URL（可选）
   - 同步频率
   - 冲突解决策略

## 安装 U盾/SIMKey厂家管理系统

### 一键启动（推荐）

#### Windows

```cmd
cd manufacturer-system
start.bat
```

#### Linux/Mac

```bash
cd manufacturer-system
chmod +x start.sh
./start.sh
```

### 访问系统

等待30秒后，访问以下地址：

- **前端管理界面**: http://localhost
- **API文档**: http://localhost:8080/api/swagger-ui.html
- **默认账号**: admin
- **默认密码**: admin123456

### 手动部署（可选）

如果您需要自定义配置，可以手动部署：

```bash
# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

## 验证安装

### ChainlessChain 系统

1. **检查后端服务**

```bash
# 检查MySQL
docker-compose exec mysql mysql -u root -p -e "SELECT 1"

# 检查Redis
docker-compose exec redis redis-cli ping

# 检查Ollama
curl http://localhost:11434/api/tags
```

2. **测试PC端功能**
   - 创建一个测试笔记
   - 使用AI问答功能
   - 测试搜索功能

3. **测试同步功能**
   - 创建Git仓库或使用现有仓库
   - 执行首次同步
   - 检查文件是否正确同步

### 厂家管理系统

1. **登录系统**
   - 访问 http://localhost
   - 使用默认账号登录
   - 查看Dashboard数据

2. **测试设备注册**
   - 进入"注册设备"页面
   - 注册一个测试设备
   - 在"设备管理"中查看

3. **测试APP上传**
   - 进入"上传APP版本"页面
   - 上传一个测试文件
   - 检查版本列表

## 常见问题

### ChainlessChain 系统

#### Q: Docker服务启动失败

**A**: 检查端口占用情况

```bash
# Windows
netstat -ano | findstr "3306"
netstat -ano | findstr "6379"
netstat -ano | findstr "11434"

# Linux/Mac
lsof -i :3306
lsof -i :6379
lsof -i :11434
```

如果端口被占用，可以在`docker-compose.yml`中修改端口映射。

#### Q: Ollama模型下载失败

**A**: 手动下载模型

```bash
# 进入Ollama容器
docker-compose exec ollama bash

# 下载模型
ollama pull llama3
ollama pull qwen
```

#### Q: PC端启动白屏

**A**: 清除缓存并重启

```bash
# 清除node_modules
rm -rf node_modules
rm -rf desktop/node_modules

# 重新安装
npm install

# 重新启动
npm run dev:desktop
```

### 厂家管理系统

#### Q: 无法访问前端页面

**A**: 检查容器状态

```bash
# 查看所有容器
docker-compose ps

# 重启前端容器
docker-compose restart frontend

# 查看日志
docker-compose logs frontend
```

#### Q: API请求401错误

**A**: 清除浏览器缓存

1. 打开浏览器开发者工具（F12）
2. Application -> Storage -> Clear site data
3. 刷新页面并重新登录

#### Q: 文件上传失败

**A**: 检查上传目录权限

```bash
# 创建上传目录
mkdir -p data/uploads

# 设置权限（Linux/Mac）
chmod 777 data/uploads

# Windows不需要设置权限
```

## 开发环境配置

### IDE推荐

- **VS Code**: 推荐安装以下插件
  - Vue Language Features (Volar)
  - ESLint
  - Prettier
  - Docker

- **IntelliJ IDEA**: 适合Java后端开发
  - Spring Boot插件
  - MyBatis插件

### 调试配置

#### VS Code调试配置 (.vscode/launch.json)

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Desktop App",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev:desktop"],
      "console": "integratedTerminal"
    },
    {
      "name": "Attach to Chrome",
      "type": "chrome",
      "request": "attach",
      "port": 9222,
      "webRoot": "${workspaceFolder}"
    }
  ]
}
```

## 下一步

现在您已经成功安装了ChainlessChain系统，接下来可以：

- [了解系统架构](/guide/architecture) - 深入了解技术实现
- [ChainlessChain配置](/chainlesschain/configuration) - 自定义系统配置
- [厂家系统功能](/manufacturer/overview) - 学习设备管理
- [API参考](/api/introduction) - 集成开发

## 获取帮助

如果遇到问题，可以通过以下方式获取帮助：

- 📖 [查看完整文档](/)
- 🐛 [报告问题](https://github.com/chainlesschain/chainlesschain/issues)
- 💬 [加入社区讨论](https://community.chainlesschain.com)
- 📧 **邮箱**: zhanglongfa@chainlesschain.com
- 📞 **电话**: 400-1068-687

---

**祝您使用愉快！**


## 附录：规范章节补全（v5.0.2.34）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

本附录以快速上手视角补齐所有标准章节：从安装路径、环境变量、常用命令，到测试、故障排除、性能指标等维度做一站式摘要。主体安装步骤见上文。

### 2. 核心特性

- 三端独立安装路径（Desktop / CLI / Android）
- Docker Compose 一键起依赖（Ollama / Qdrant / Postgres / Redis）
- `.chainlesschain/config.json` 统一配置目录
- `cc doctor` 自检命令快速定位环境问题

### 3. 系统架构

见 [系统架构](/guide/architecture)。快速上手时只需关心：前端（desktop / cli）+ 后端（docker compose 服务）+ AI（Ollama / Qdrant）三组件均可本地启动。

### 4. 系统定位

面向"**最快 15 分钟上手**"：新用户先跑通 CLI 的 `cc chat` 或桌面端 `npm run dev`，再按需启用后端 / AI / P2P。

### 5. 核心功能

| 路径 | 命令 |
|---|---|
| 全局 CLI | `npm i -g chainlesschain` |
| 桌面版 | `cd desktop-app-vue && npm install && npm run dev` |
| 后端依赖 | `docker-compose up -d` |
| CLI 测试 | `cd packages/cli && npm test` |
| 自检 | `cc doctor` |

### 6. 技术架构

见 [技术栈](/guide/tech-stack)。首次安装关键依赖：Node ≥ 20、Docker（Desktop / Engine）、可选 Java 17 + Python 3.10+（自建后端）。

### 7. 系统特点

- **零配置优先**：不填环境变量也能跑基础对话（本地 Ollama + SQLite）
- **环境变量覆盖**：所有默认都可被 `.env` / `config.json` 覆盖
- **Docker 可选**：最小可用仅需 Node + 本地 Ollama
- **跨平台**：Windows / macOS / Linux 都走相同命令（U-Key 仅 Windows 原生）

### 8. 应用场景

- 新用户试用：CLI `cc chat` 一条命令
- 开发者：`npm run dev` + DevTools
- 运维：`docker-compose up -d` + 观察 `docker logs`
- 企业员工：拿到 `.ccprofile` 后自动切换 LLM / 品牌

### 9. 竞品对比

| 维度 | ChainlessChain | Ollama 裸用 | Open WebUI |
|---|---|---|---|
| 全栈一键起 | ✅ `docker-compose up` | ⚠️ 仅推理 | ⚠️ 仅 UI |
| CLI + 桌面双端 | ✅ | ❌ | ❌ |
| 环境自检 | ✅ `cc doctor` | ❌ | ❌ |
| 企业下发配置 | ✅ Profile / MDM | ❌ | ❌ |

### 10. 配置参考

```bash
# 关键环境变量（.env 或 shell）
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333
DB_HOST=localhost:5432
REDIS_HOST=localhost:6379
```

主配置文件位置：

```
# Windows
%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/config.json

# macOS
~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/config.json

# Linux
~/.config/chainlesschain-desktop-vue/.chainlesschain/config.json
```

### 11. 性能指标

- `npm install`（桌面端首次）：3–8min（视网络）
- 桌面冷启动：≈ 2.4s
- `cc --help`：< 300ms
- `docker-compose up -d`（已拉镜像）：< 10s

### 12. 测试覆盖

- 累计 **14,800+** 测试
- 首次安装后运行 `cc test` 或 `npx vitest run tests/unit/` 抽查
- CI：`.github/workflows/test.yml`

### 13. 安全考虑

- 首次运行会生成 DID 与本地密钥；请备份 `.chainlesschain/` 目录
- U-Key（Windows）可显著提升私钥安全；非 Windows 走 simulation 模式
- 不要把 `.env` 与生产密钥提交到 Git

### 14. 故障排除

- **`npm install` 卡 electron 下载**：设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
- **Docker 起不来**：`docker info` 检查 Docker Desktop 已启动
- **Ollama 无响应**：`curl http://localhost:11434/api/tags`
- **Qdrant 端口占用**：改 `docker-compose.yml` 的 6333 映射
- **`cc` 命令未找到**：`npm i -g chainlesschain` 后重开终端

### 15. 关键文件

```
.env.example                    # 环境变量样例
docker-compose.yml              # 基础设施编排
desktop-app-vue/package.json    # 桌面版入口
packages/cli/package.json       # CLI 入口
.chainlesschain/config.json     # 用户主配置
.chainlesschain/rules.md        # 项目规则（优先级 > CLAUDE.md）
```

### 16. 使用示例

```bash
# 一键基础栈
npm i -g chainlesschain
cc doctor         # 自检
cc chat "你好"     # 本地对话

# 完整桌面开发
git clone <repo>
cd chainlesschain
docker-compose up -d
cd desktop-app-vue && npm install && npm run dev
```

### 17. 相关文档

- [系统简介](/guide/introduction)
- [系统架构](/guide/architecture)
- [技术栈](/guide/tech-stack)
- [桌面版 V6 对话壳](/guide/desktop-v6-shell)
- [合规与威胁情报](/guide/compliance-threat-intel)
- [去中心化社交协议](/guide/social-protocols)
- [系统设计主文档](/design/)
