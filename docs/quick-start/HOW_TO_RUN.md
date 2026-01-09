# ChainlessChain 运行指南

**版本**: v0.17.0
**更新时间**: 2025-12-29

本文档提供ChainlessChain各个组件的详细运行说明。

---

## 目录

1. [桌面应用](#桌面应用)
2. [后端服务](#后端服务)
3. [浏览器扩展](#浏览器扩展)
4. [智能合约](#智能合约)
5. [开发工具](#开发工具)
6. [部署指南](#部署指南)

---

## 桌面应用

### 开发模式

```bash
cd desktop-app-vue

# 方式1: 标准开发模式 (推荐)
npm run dev

# 方式2: 仅Electron (需先构建主进程)
npm run build:main
npm run dev:electron

# 方式3: 仅Renderer (前端热重载)
npm run dev:renderer
```

### 构建模式

```bash
# 构建所有
npm run build

# 仅构建主进程
npm run build:main

# 仅构建渲染进程
npm run build:renderer
```

### 打包发布

```bash
# Windows安装程序
npm run make:win

# 通用打包
npm run package

# 发布 (需配置发布渠道)
npm run publish
```

输出目录: `out/make/`

---

## 后端服务

### Docker服务 (推荐)

**启动所有服务**:
```bash
cd backend/docker

# 启动 (后台运行)
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

**服务列表**:
- **Ollama** (LLM推理): `localhost:11434`
- **Qdrant** (向量数据库): `localhost:6333`
- **PostgreSQL** (关系数据库): `localhost:5432`
- **Redis** (缓存): `localhost:6379`

**拉取LLM模型**:
```bash
# 进入Ollama容器
docker exec -it chainlesschain-ollama /bin/bash

# 拉取模型
ollama pull qwen2:7b
ollama pull nomic-embed-text

# 列出已安装模型
ollama list

# 退出容器
exit
```

### AI Service (FastAPI)

```bash
cd backend/ai-service

# 安装依赖
pip install -r requirements.txt

# 开发模式 (热重载)
uvicorn main:app --reload --port 8001

# 生产模式
uvicorn main:app --host 0.0.0.0 --port 8001 --workers 4
```

**环境变量** (`.env`):
```bash
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333
QDRANT_API_KEY=

# 云LLM API密钥 (可选)
DASHSCOPE_API_KEY=       # 阿里云
ZHIPUAI_API_KEY=         # 智谱
QIANFAN_API_KEY=         # 百度
OPENAI_API_KEY=          # OpenAI
```

**API文档**:
- Swagger UI: `http://localhost:8001/docs`
- ReDoc: `http://localhost:8001/redoc`

### Project Service (Spring Boot)

```bash
cd backend/project-service

# 方式1: Maven运行
mvn spring-boot:run

# 方式2: JAR运行
mvn clean package
java -jar target/project-service-0.1.0.jar

# 跳过测试
mvn spring-boot:run -DskipTests
```

**配置文件** (`src/main/resources/application.yml`):
```yaml
server:
  port: 9090

spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/chainlesschain
    username: chainlesschain
    password: chainlesschain_pwd_2024
    
  redis:
    host: localhost
    port: 6379
    password: chainlesschain_redis_2024
```

**数据库初始化**:
```bash
# 自动创建表 (首次运行)
# application.yml: spring.jpa.hibernate.ddl-auto=update

# 或手动执行SQL
psql -U chainlesschain -d chainlesschain -f db/schema.sql
```

### Community Forum

**后端**:
```bash
cd community-forum/backend
mvn spring-boot:run
```

**前端**:
```bash
cd community-forum/frontend
npm install
npm run dev
```

访问: `http://localhost:5174`

---

## 浏览器扩展

### Chrome扩展

**开发模式**:
```bash
cd desktop-app-vue/browser-extension

# 1. 打包扩展
npm run build:chrome

# 2. 加载到Chrome
# 打开 chrome://extensions/
# 开启"开发者模式"
# 点击"加载已解压的扩展程序"
# 选择 browser-extension/dist/chrome 目录
```

**测试**:
```bash
# 运行自动化测试
npm run test:extension
```

### Firefox扩展

```bash
# 构建Firefox版本
npm run build:firefox

# 临时加载
# 打开 about:debugging#/runtime/this-firefox
# 点击"临时载入附加组件"
# 选择 manifest.json
```

---

## 智能合约

### 本地开发网络

```bash
cd contracts

# 安装依赖
npm install

# 启动Hardhat本地网络
npx hardhat node

# 保持终端运行，新开终端执行部署
```

### 编译合约

```bash
# 编译所有合约
npx hardhat compile

# 清理并重新编译
npx hardhat clean
npx hardhat compile
```

### 测试合约

```bash
# 运行所有测试
npx hardhat test

# 运行特定测试
npx hardhat test test/ChainlessToken.test.js

# 测试覆盖率
npx hardhat coverage
```

### 部署合约

**本地网络**:
```bash
npx hardhat run scripts/deploy.js --network localhost
```

**测试网 (Sepolia)**:
```bash
# 配置 hardhat.config.js
networks: {
  sepolia: {
    url: "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
    accounts: [PRIVATE_KEY]
  }
}

# 部署
npx hardhat run scripts/deploy.js --network sepolia
```

**主网 (谨慎!)**:
```bash
npx hardhat run scripts/deploy.js --network mainnet
```

### 验证合约

```bash
# Etherscan验证
npx hardhat verify --network sepolia DEPLOYED_CONTRACT_ADDRESS "Constructor arg 1"
```

---

## 开发工具

### 测试

**单元测试**:
```bash
cd desktop-app-vue

# 运行所有测试
npm run test

# 运行特定测试
npm run test:unit

# 测试覆盖率
npm run test:coverage
```

**集成测试**:
```bash
npm run test:integration
```

**E2E测试**:
```bash
npm run test:e2e
npm run test:e2e:ui  # 可视化界面
```

**数据库测试**:
```bash
npm run test:db
```

**U盾测试**:
```bash
npm run test:ukey
```

### 代码质量

**Linting**:
```bash
# ESLint
npm run lint

# 自动修复
npm run lint:fix
```

**格式化**:
```bash
# Prettier
npm run format

# 检查格式
npm run format:check
```

### 性能测试

```bash
npm run test:performance
```

---

## 部署指南

### 开发环境

**前置条件**:
- Node.js 18+
- Python 3.10+
- Java 17
- Docker

**启动顺序**:
1. Docker服务: `npm run docker:up`
2. AI Service: `uvicorn main:app --reload`
3. Project Service: `mvn spring-boot:run`
4. Desktop App: `npm run dev:desktop-vue`

### 生产环境

#### 1. 桌面应用

```bash
# 构建生产版本
cd desktop-app-vue
npm run build

# 打包安装程序
npm run make:win

# 分发
# 输出在 out/make/ 目录
```

#### 2. 后端服务部署

**Docker Compose** (推荐):
```bash
# 使用生产配置
docker-compose -f docker-compose.prod.yml up -d
```

**Kubernetes**:
```bash
# 应用配置
kubectl apply -f k8s/

# 查看状态
kubectl get pods
kubectl logs -f deployment/ai-service
```

**传统部署**:
```bash
# AI Service (Systemd)
sudo systemctl start chainlesschain-ai
sudo systemctl enable chainlesschain-ai

# Project Service (Systemd)
sudo systemctl start chainlesschain-project
sudo systemctl enable chainlesschain-project
```

#### 3. 数据库备份

**PostgreSQL**:
```bash
# 备份
pg_dump -U chainlesschain chainlesschain > backup.sql

# 恢复
psql -U chainlesschain chainlesschain < backup.sql
```

**SQLite** (桌面应用):
```bash
# 备份
cp data/chainlesschain.db backup/chainlesschain-$(date +%Y%m%d).db

# 自动备份脚本
./scripts/backup-db.sh
```

### 云端部署

详见 [README-云端部署指南.md](./README-云端部署指南.md)

**支持的云平台**:
- AWS
- Azure
- Google Cloud
- 阿里云
- 腾讯云

---

## 故障排查

### 应用无法启动

**检查端口占用**:
```bash
# Windows
netstat -ano | findstr :5173
netstat -ano | findstr :8001

# Linux/Mac
lsof -i :5173
lsof -i :8001
```

**清理缓存**:
```bash
# Node模块
rm -rf node_modules package-lock.json
npm install

# Vite缓存
rm -rf .vite
rm -rf dist
```

### Docker服务异常

**查看日志**:
```bash
docker logs chainlesschain-ollama
docker logs chainlesschain-qdrant
docker logs chainlesschain-postgres
```

**重启服务**:
```bash
docker restart chainlesschain-ollama
```

**完全重建**:
```bash
docker-compose down -v
docker-compose up -d
```

### 数据库问题

**连接失败**:
```bash
# 检查PostgreSQL
docker exec -it chainlesschain-postgres psql -U chainlesschain -d chainlesschain

# 检查SQLite
sqlite3 data/chainlesschain.db ".tables"
```

**锁定问题**:
```bash
# 关闭应用
# 删除WAL文件
rm data/chainlesschain.db-wal
rm data/chainlesschain.db-shm
```

### Git同步问题

**推送失败**:
```bash
# 检查远程仓库
git remote -v

# 检查凭据
git config credential.helper

# 重新配置
git config --global credential.helper store
```

---

## 环境变量

### 桌面应用

创建 `desktop-app-vue/.env`:
```bash
# 开发模式
NODE_ENV=development

# Electron配置
ELECTRON_DISABLE_SECURITY_WARNINGS=true

# LLM配置
OLLAMA_HOST=http://localhost:11434
DEFAULT_LLM_MODEL=qwen2:7b

# 向量数据库
QDRANT_HOST=http://localhost:6333
```

### 后端服务

创建 `backend/ai-service/.env`:
```bash
# 基础配置
ENVIRONMENT=development
LOG_LEVEL=INFO

# 服务端口
PORT=8001

# Ollama
OLLAMA_HOST=http://localhost:11434

# Qdrant
QDRANT_HOST=http://localhost:6333
QDRANT_COLLECTION=chainlesschain

# 云LLM (可选)
DASHSCOPE_API_KEY=
ZHIPUAI_API_KEY=
```

创建 `backend/project-service/.env`:
```bash
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=chainlesschain
DB_PASSWORD=chainlesschain_pwd_2024

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=chainlesschain_redis_2024

# JWT
JWT_SECRET=your-secret-key-change-in-production
```

---

## 性能优化

### 开发环境

**启用缓存**:
```bash
# npm缓存
npm config set cache .npm-cache --global

# Vite缓存
# vite.config.ts
cacheDir: '.vite'
```

**并行构建**:
```bash
# 增加并行任务数
npm config set maxsockets 50
```

### 生产环境

**代码分割**:
```javascript
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'vendor': ['vue', '
