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
