# 配置文件目录

本目录包含项目的各类配置文件。

## 📁 目录结构

### 🐳 docker/
Docker相关配置文件（5个）

**主配置**:
- `docker-compose.yml` - 开发环境Docker配置（默认）

**环境配置**:
- `docker-compose.cloud.yml` - 云端部署配置
- `docker-compose.production.yml` - 生产环境配置
- `docker-compose.full.yml` - 完整服务配置
- `docker-compose.monitoring.yml` - 监控服务配置

## 🚀 使用方法

### 开发环境
```bash
# 使用默认配置启动
docker-compose -f config/docker/docker-compose.yml up -d

# 或者在根目录使用（需要符号链接）
docker-compose up -d
```

### 生产环境
```bash
# 生产环境部署
docker-compose -f config/docker/docker-compose.production.yml up -d
```

### 云端部署
```bash
# 云端环境
docker-compose -f config/docker/docker-compose.cloud.yml up -d
```

### 完整服务
```bash
# 启动所有服务（包括监控）
docker-compose -f config/docker/docker-compose.full.yml up -d
```

### 仅监控服务
```bash
# 启动监控相关服务
docker-compose -f config/docker/docker-compose.monitoring.yml up -d
```

## 📋 服务说明

### docker-compose.yml (开发环境)
包含的服务：
- Ollama (本地LLM)
- Qdrant (向量数据库)
- PostgreSQL (关系数据库)
- Redis (缓存)
- AI Service (FastAPI)
- Project Service (Spring Boot)

### docker-compose.cloud.yml (云端)
额外包含：
- Nginx反向代理
- SSL证书配置
- 云端优化配置

### docker-compose.production.yml (生产)
优化配置：
- 资源限制
- 健康检查
- 重启策略
- 日志配置

### docker-compose.monitoring.yml (监控)
监控服务：
- Prometheus
- Grafana
- Node Exporter

## ⚙️ 环境变量

配置文件使用的环境变量（需在 `.env` 文件中设置）：

```bash
# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=chainlesschain
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_password

# Ollama
OLLAMA_HOST=http://localhost:11434

# Qdrant
QDRANT_HOST=http://localhost:6333
```

参考 `.env.example` 获取完整的环境变量列表。

---

**最后更新**: 2026-01-03
