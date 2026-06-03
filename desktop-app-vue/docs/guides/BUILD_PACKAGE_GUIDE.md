# ChainlessChain 一体化打包指南

本指南说明如何使用新的一体化打包系统，将前端 Electron 应用和后端 Docker 服务打包成单一的 Windows 安装包。

## 文件说明

### 1. `build-windows-package.bat` - 统一构建脚本

**新创建的一体化构建脚本**，替代了原来分散的构建流程。

**功能**：
- ✅ 自动检查构建环境（Node.js, npm, Inno Setup）
- ✅ 构建前端 Electron 应用（Renderer + Main Process）
- ✅ 打包前端应用（`npm run package`）
- ✅ 复制后端 Docker Compose 配置到打包目录
- ✅ 创建后端服务管理脚本
- ✅ 创建一键启动脚本（前端 + 后端）
- ✅ 生成安装说明文档
- ✅ 调用 Inno Setup 生成最终安装包

### 2. `installer.iss` - Inno Setup 配置（已更新）

**更新内容**：
- ✅ 包含后端 Docker 服务配置文件
- ✅ 包含一键启动脚本和服务管理脚本
- ✅ 添加 Docker Desktop 检测逻辑
- ✅ 安装时提示用户 Docker 依赖
- ✅ 创建额外的快捷方式：
  - "启动 ChainlessChain (含后端)" - 一键启动前后端
  - "管理后端服务" - Docker 服务管理界面
- ✅ 卸载时可选清理 Docker 容器和数据

### 3. 自动生成的脚本

运行 `build-windows-package.bat` 后会自动生成：

#### `out/ChainlessChain-win32-x64/backend-services/manage-backend.bat`
后端服务管理脚本，提供菜单式操作：
- 启动后端服务
- 停止后端服务
- 查看服务状态
- 查看服务日志
- 重启服务

#### `out/ChainlessChain-win32-x64/start-all.bat`
一键启动脚本，自动：
1. 检测并启动 Docker Desktop
2. 启动后端 Docker 服务
3. 启动前端 Electron 应用

## 使用方法

### 一键打包（推荐）

```bash
cd desktop-app-vue
build-windows-package.bat
```

执行步骤：
1. 检查环境（Node.js, npm, Inno Setup）
2. 安装 npm 依赖（如果需要）
3. 构建前端应用（Renderer + Main）
4. 打包 Electron 应用
5. 准备后端服务文件
6. 创建管理脚本
7. 生成 Windows 安装包

### 分步执行（可选）

如果需要单独执行某些步骤：

```bash
# 1. 仅构建前端
npm run build

# 2. 仅打包前端（不生成安装包）
npm run package

# 3. 仅生成安装包（需先执行 build-windows-package.bat 准备文件）
build-installer.bat
```

## 输出文件

执行成功后，输出文件位于：

```
desktop-app-vue/
├── out/
│   ├── ChainlessChain-win32-x64/           # 打包后的应用
│   │   ├── chainlesschain.exe              # 主程序
│   │   ├── start-all.bat                   # 一键启动脚本
│   │   └── backend-services/               # 后端服务
│   │       ├── docker-compose.yml          # Docker 配置
│   │       ├── .env.example                # 环境变量示例
│   │       └── manage-backend.bat          # 服务管理脚本
│   └── installer/
│       └── ChainlessChain-Setup-0.1.0.exe  # 最终安装包
```

## 安装包特性

生成的安装包（`ChainlessChain-Setup-*.exe`）包含：

### 前端部分
- Electron 应用（约 200-300MB）
- 所有依赖的 Node.js 模块
- SQLite 数据库（空数据库）

### 后端部分
- `docker-compose.yml` 配置文件
- `.env.example` 环境变量模板
- 服务管理脚本

### 快捷方式
安装后会创建以下快捷方式：
1. **桌面**：
   - ChainlessChain（仅前端）
   - 启动 ChainlessChain (含后端)（推荐）
2. **开始菜单**：
   - ChainlessChain
   - 启动 ChainlessChain (含后端)
   - 管理后端服务
   - 卸载 ChainlessChain

### 智能检测
- **安装时**：检测 Docker Desktop 是否安装
  - 已安装：正常安装
  - 未安装：提示用户安装 Docker Desktop，可选择继续或取消
- **首次运行**：提示首次启动需要下载约 2-3GB 的 Docker 镜像
- **卸载时**：询问是否保留数据和是否清理 Docker 容器

## 用户使用流程

### 首次安装

1. 运行 `ChainlessChain-Setup-*.exe`
2. 如果未安装 Docker Desktop：
   - 安装程序会提示下载安装 Docker Desktop
   - 用户可选择先安装 Docker 或稍后安装
3. 完成 ChainlessChain 安装
4. 如果需要安装 Docker Desktop：
   - 访问 https://www.docker.com/products/docker-desktop
   - 下载并安装 Docker Desktop
   - 重启计算机（Docker 要求）

### 首次启动

**方式 1：一键启动（推荐）**
1. 双击桌面上的 "启动 ChainlessChain (含后端)" 快捷方式
2. 脚本会自动：
   - 检测 Docker Desktop 是否运行
   - 启动 Docker Desktop（如果未运行）
   - 启动后端服务（首次会下载镜像，约 2-3GB）
   - 启动前端应用

**方式 2：分别启动**
1. 运行 "管理后端服务"，选择 "启动后端服务"
2. 双击 "ChainlessChain" 图标启动前端

### 日常使用

**推荐使用一键启动**：
- 双击 "启动 ChainlessChain (含后端)" 即可

**手动管理**：
- 使用 "管理后端服务" 可以：
  - 查看服务状态
  - 查看服务日志
  - 重启服务
  - 停止服务

## 系统要求

### 最低要求
- **操作系统**: Windows 10/11 (64-bit)
- **内存**: 8GB RAM
- **磁盘空间**: 20GB 可用空间
- **Docker Desktop**: 最新版本

### 推荐配置
- **操作系统**: Windows 11 (64-bit)
- **内存**: 16GB RAM 或更多
- **磁盘空间**: 50GB 可用空间（含 LLM 模型）
- **GPU**: NVIDIA GPU（用于加速 Ollama LLM 推理）

## 后端服务说明

安装包包含以下后端服务的 Docker 配置：

| 服务 | 端口 | 用途 |
|------|------|------|
| Ollama | 11434 | 本地 LLM 服务 |
| Qdrant | 6333 | 向量数据库（AI 服务使用） |
| ChromaDB | 8000 | 向量数据库（Desktop App 使用） |
| PostgreSQL | 5432 | 关系数据库（项目元数据） |
| Redis | 6379 | 缓存服务 |
| AI Service | 8001 | AI 推理服务（FastAPI） |
| Project Service | 9090 | 项目管理服务（Spring Boot） |

### 首次启动下载内容
- Ollama: ~500MB
- Qdrant: ~100MB
- ChromaDB: ~200MB
- PostgreSQL: ~150MB
- Redis: ~50MB
- AI Service 依赖: ~500MB
- LLM 模型（qwen2:7b）: ~4GB

**总计约 5-6GB**

## 故障排除

### 问题 1: "Docker 未安装或未运行"

**解决方案**：
1. 检查 Docker Desktop 是否已安装
2. 启动 Docker Desktop
3. 等待 Docker Desktop 完全启动（任务栏图标不再旋转）
4. 重新运行启动脚本

### 问题 2: 端口被占用

**错误信息**: "port is already allocated" 或类似错误

**解决方案**：
1. 检查哪个端口被占用：
   ```bash
   netstat -ano | findstr :11434  # 替换为具体端口
   ```
2. 关闭占用端口的程序
3. 或修改 `docker-compose.yml` 中的端口映射

### 问题 3: Docker 镜像下载慢

**解决方案**：
1. 配置 Docker 镜像加速器
2. 或使用 VPN 加速下载

### 问题 4: 启动后前端连接不上后端

**检查步骤**：
1. 运行 "管理后端服务" → "查看服务状态"
2. 确认所有服务都是 "Up" 状态
3. 检查防火墙是否阻止了端口访问
4. 查看服务日志排查错误：
   ```bash
   docker-compose logs -f
   ```

## 与原有流程的区别

### 原流程（分散）
```bash
# 1. 构建前端
npm run build

# 2. 打包前端
npm run package

# 3. 生成安装包
build-installer.bat

# 4. 用户安装后需要手动：
#    - 安装 Docker Desktop
#    - 运行 docker-compose up
#    - 启动前端应用
```

### 新流程（一体化）
```bash
# 开发者：一键构建
build-windows-package.bat

# 用户：一键安装 + 一键启动
# 1. 运行安装包
# 2. 双击 "启动 ChainlessChain (含后端)"
```

## 高级用法

### 自定义后端配置

编辑 `backend-services/.env` 文件（安装后）：
```env
# LLM 配置
OLLAMA_HOST=http://localhost:11434

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chainlesschain

# 云 LLM API Key（可选）
DASHSCOPE_API_KEY=your_key_here
```

### 使用云 LLM 服务

如果不想使用本地 Ollama，可以：
1. 编辑 `backend-services/.env`
2. 添加云服务 API Key
3. 在前端应用设置中选择云服务提供商

### 自定义 Docker Compose

编辑 `backend-services/docker-compose.yml`：
- 修改端口映射
- 调整资源限制
- 添加/删除服务

## 开发建议

### 更新打包脚本

如果需要修改打包流程，编辑 `build-windows-package.bat`：
- 添加新的构建步骤
- 修改文件复制逻辑
- 调整输出路径

### 更新安装程序

如果需要修改安装行为，编辑 `installer.iss`：
- 添加新的文件/目录
- 修改快捷方式
- 调整安装逻辑（[Code] 部分）

### 测试打包结果

```bash
# 1. 执行打包
build-windows-package.bat

# 2. 测试打包后的应用（不安装）
cd out\ChainlessChain-win32-x64
start-all.bat

# 3. 测试安装包
out\installer\ChainlessChain-Setup-*.exe
```

## 持续改进

计划添加的功能：
- [ ] 支持离线安装包（预下载 Docker 镜像）
- [ ] 支持增量更新
- [ ] 自动检测并安装 Docker Desktop
- [ ] 添加卸载后清理脚本
- [ ] 支持 macOS 和 Linux 打包

## 相关文档

- [CLAUDE.md](../CLAUDE.md) - 项目总体说明
- [README.md](../README.md) - 项目介绍
- [QUICK_START.md](../QUICK_START.md) - 快速开始指南
- [Docker 配置](../docker-compose.yml) - Docker Compose 配置文件

## 联系支持

如有问题，请：
1. 查看本文档的"故障排除"部分
2. 查看 GitHub Issues
3. 提交新的 Issue
