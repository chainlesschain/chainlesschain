# ChainlessChain Docker 打包方案 🐳

## 🎯 方案概述

**核心思路**:
- ✅ 后端服务（PostgreSQL, Redis, Qdrant, Ollama）→ Docker Compose
- ✅ 桌面应用（Electron前端）→ 独立安装包，连接到Docker服务
- ✅ 跨平台支持：Windows, macOS, Linux

**优势**:
- ✅ 无需下载巨大的便携式依赖 (~260MB)
- ✅ 统一的环境配置
- ✅ 易于升级和维护
- ✅ 真正的跨平台支持

---

## 📦 打包架构

```
ChainlessChain 部署包
├── desktop-app/                    # Electron 桌面应用
│   └── ChainlessChain-Setup.exe    # Windows 安装程序
│       ChainlessChain.dmg          # macOS 镜像
│       ChainlessChain.AppImage     # Linux 应用
│
├── docker-compose.yml              # 后端服务配置
├── .env.example                    # 环境变量模板
├── start-services.sh               # 启动脚本 (Linux/Mac)
├── start-services.bat              # 启动脚本 (Windows)
└── README.md                       # 部署说明
```

---

## 🚀 实施步骤

### 步骤 1: 创建轻量级 Electron 安装包

修改配置，移除所有后端依赖检查：

```bash
cd D:/code/chainlesschain/desktop-app-vue

# 编辑 forge.config.js，确保始终跳过后端检查
# 已完成 ✅
```

打包桌面应用（仅前端）：

```bash
# Windows
export SKIP_BACKEND_CHECK=true
npm run make:win

# macOS (在 Mac 上运行)
export SKIP_BACKEND_CHECK=true
npm run make

# Linux (在 Linux 上运行)
export SKIP_BACKEND_CHECK=true
npm run make -- --platform=linux
```

---

### 步骤 2: 配置应用连接到 Docker 服务

修改桌面应用的默认配置，连接到本地 Docker 服务：

**`desktop-app-vue/src/main/config/default-config.js`**:

```javascript
module.exports = {
  database: {
    type: 'sqlite', // 本地数据库
    path: path.join(app.getPath('userData'), 'chainlesschain.db')
  },

  backend: {
    // 连接到 Docker Compose 服务
    projectService: {
      enabled: true,
      host: 'localhost',
      port: 9090,
      useDocker: true // 标记使用 Docker
    },

    postgresql: {
      host: 'localhost',
      port: 5432,
      database: 'chainlesschain',
      user: 'chainlesschain',
      password: 'your-secure-password'
    },

    redis: {
      host: 'localhost',
      port: 6379
    },

    qdrant: {
      host: 'localhost',
      port: 6333
    },

    ollama: {
      host: 'http://localhost:11434'
    }
  }
};
```

---

### 步骤 3: 创建 Docker Compose 部署包

**`packaging/docker-compose.yml`** (简化版):

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: chainlesschain-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: chainlesschain
      POSTGRES_USER: chainlesschain
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-your-secure-password}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: chainlesschain-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  qdrant:
    image: qdrant/qdrant:v1.12.5
    container_name: chainlesschain-qdrant
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant-data:/qdrant/storage
    restart: unless-stopped

  ollama:
    image: ollama/ollama:latest
    container_name: chainlesschain-ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    restart: unless-stopped
    # GPU 支持 (可选)
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]

  project-service:
    build:
      context: ../backend/project-service
      dockerfile: Dockerfile
    container_name: chainlesschain-project-service
    ports:
      - "9090:9090"
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: chainlesschain
      DB_USER: chainlesschain
      DB_PASSWORD: ${POSTGRES_PASSWORD:-your-secure-password}
      REDIS_HOST: redis
      REDIS_PORT: 6379
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

volumes:
  postgres-data:
  redis-data:
  qdrant-data:
  ollama-data:

networks:
  default:
    name: chainlesschain-network
```

---

### 步骤 4: 创建启动脚本

**`packaging/start-services.sh`** (Linux/Mac):

```bash
#!/bin/bash

echo "=== ChainlessChain Backend Services ==="
echo "Starting Docker services..."

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# 启动服务
docker-compose up -d

echo ""
echo "✅ Services started successfully!"
echo ""
echo "Services:"
echo "  - PostgreSQL: localhost:5432"
echo "  - Redis:      localhost:6379"
echo "  - Qdrant:     localhost:6333"
echo "  - Ollama:     http://localhost:11434"
echo "  - API:        http://localhost:9090"
echo ""
echo "To stop services: docker-compose down"
echo "To view logs:     docker-compose logs -f"
```

**`packaging/start-services.bat`** (Windows):

```batch
@echo off
echo === ChainlessChain Backend Services ===
echo Starting Docker services...

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Start services
docker-compose up -d

echo.
echo Services started successfully!
echo.
echo Services:
echo   - PostgreSQL: localhost:5432
echo   - Redis:      localhost:6379
echo   - Qdrant:     localhost:6333
echo   - Ollama:     http://localhost:11434
echo   - API:        http://localhost:9090
echo.
echo To stop services: docker-compose down
echo To view logs:     docker-compose logs -f
echo.
pause
```

---

### 步骤 5: 创建用户部署指南

**`packaging/DEPLOYMENT_GUIDE.md`**:

```markdown
# ChainlessChain 部署指南

## 系统要求

- Windows 10/11, macOS 10.14+, 或 Ubuntu 18.04+
- Docker Desktop (或 Docker Engine + Docker Compose)
- 8GB RAM (推荐 16GB)
- 20GB 可用磁盘空间

## 安装步骤

### 1. 安装 Docker Desktop

**Windows/Mac**:
- 下载: https://www.docker.com/products/docker-desktop/
- 安装并启动 Docker Desktop

**Linux**:
```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install docker.io docker-compose
sudo systemctl start docker
```

### 2. 启动后端服务

**Windows**:
双击运行 `start-services.bat`

**Linux/Mac**:
```bash
chmod +x start-services.sh
./start-services.sh
```

### 3. 安装桌面应用

**Windows**: 运行 `ChainlessChain-Setup.exe`
**macOS**: 打开 `ChainlessChain.dmg` 并拖拽到应用程序
**Linux**:
```bash
chmod +x ChainlessChain.AppImage
./ChainlessChain.AppImage
```

### 4. 首次启动配置

1. 启动 ChainlessChain 应用
2. 应用会自动连接到本地 Docker 服务
3. 首次启动会自动初始化数据库

## 管理服务

### 停止服务
```bash
docker-compose down
```

### 查看日志
```bash
docker-compose logs -f [service_name]
```

### 重启服务
```bash
docker-compose restart
```

### 更新服务
```bash
docker-compose pull
docker-compose up -d
```

## 故障排除

### 问题: Docker 服务无法启动

**检查**:
- Docker Desktop 是否正在运行？
- 端口是否被占用？ (5432, 6379, 6333, 11434)

**解决**:
```bash
# 查看占用端口的进程
netstat -ano | findstr :5432  # Windows
lsof -i :5432                 # Linux/Mac
```

### 问题: 应用无法连接到服务

**检查**:
- 所有 Docker 服务是否健康？
```bash
docker-compose ps
```

- 尝试重启服务：
```bash
docker-compose restart
```
```

---

## 📊 方案对比

| 特性 | Docker 方案 | 便携式依赖方案 |
|-----|------------|---------------|
| **包大小** | ~60MB (应用) + 镜像缓存 | ~400MB (全部) |
| **跨平台** | ✅ 完美支持 | ❌ 需分别编译 |
| **维护性** | ✅ 易于升级 | ⚠️ 需重新打包 |
| **环境隔离** | ✅ 完全隔离 | ❌ 可能冲突 |
| **启动速度** | ⚠️ 首次较慢 | ✅ 快速 |
| **网络要求** | ⚠️ 首次需下载镜像 | ❌ 需下载依赖 |
| **适用场景** | 开发/部署 | 离线环境 |

---

## ✅ 实施清单

- [ ] 修改 `forge.config.js` 支持 Docker 模式
- [ ] 创建 `docker-compose.yml` 部署配置
- [ ] 创建启动脚本 (Windows/Linux/Mac)
- [ ] 编写部署文档
- [ ] 测试 Docker 模式打包
- [ ] 测试跨平台部署

---

## 🎯 立即开始

```bash
# 1. 打包轻量级桌面应用
cd D:/code/chainlesschain/desktop-app-vue
export SKIP_BACKEND_CHECK=true
npm run make:win

# 2. 复制 docker-compose.yml 到打包目录
cp ../docker-compose.yml out/

# 3. 测试 Docker 服务
cd ../
docker-compose up -d

# 4. 运行应用测试连接
```

---

**Docker 方案 = 现代化 + 跨平台 + 易维护！**
