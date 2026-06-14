# ChainlessChain 后端云端部署方案

## 📋 方案概述

本文档提供ChainlessChain后端服务的完整云端部署方案，适用于：
- 移动端（iOS/Android）客户端的后端支持
- 纯云端PC客户端（Web版或轻量级客户端）
- 多用户协作场景

**部署架构：**
```
                    ┌─────────────────┐
                    │   Load Balancer │
                    │    (Nginx)      │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
      ┌───────▼────────┐          ┌────────▼────────┐
      │ Project Service│          │   AI Service    │
      │  (Spring Boot) │◄─────────┤   (FastAPI)     │
      │   Port: 9090   │          │   Port: 8001    │
      └───────┬────────┘          └────────┬────────┘
              │                             │
    ┌─────────┴─────────┬──────────────────┴────────┐
    │                   │                            │
┌───▼────┐      ┌──────▼──────┐           ┌─────────▼────────┐
│PostgreSQL│      │    Redis    │           │     Qdrant      │
│Port: 5432│      │  Port: 6379 │           │   Port: 6333    │
└──────────┘      └─────────────┘           └──────────────────┘
```

---

## 🎯 部署模式选择

### 模式一：纯云端LLM模式（推荐）

**适用场景：**
- 生产环境
- 服务器无GPU或GPU算力不足
- 需要快速部署
- 成本可控

**优势：**
- 无需GPU，降低硬件成本
- 部署简单，启动快速
- 使用阿里云、智谱AI等成熟LLM服务
- 按需付费，成本可预测

**劣势：**
- 依赖外部API，需要稳定网络
- 每次调用产生费用
- 数据需发送到第三方（可选择国内合规厂商）

### 模式二：自建LLM模式

**适用场景：**
- 拥有GPU服务器（NVIDIA RTX 3090/4090或更高）
- 数据安全要求高，不能使用外部API
- 长期大量使用，自建更经济
- 需要模型定制化

**优势：**
- 数据完全私有
- 无API调用费用
- 可定制模型
- 响应速度可能更快（本地网络）

**劣势：**
- 需要GPU服务器，硬件成本高
- 需要维护Ollama和模型
- 占用大量存储空间（7B模型约4GB+）
- 启动时间较长

### 模式三：混合模式

**适用场景：**
- 既有GPU服务器，又希望保留云端备份
- 不同功能使用不同LLM（如本地处理敏感数据，云端处理一般查询）

**优势：**
- 灵活性高
- 可根据场景选择最优方案

**劣势：**
- 配置复杂
- 需要管理多个LLM连接

---

## 📦 方案一：纯云端LLM部署（推荐）

### 1.1 服务器要求

**最低配置：**
- CPU: 4核
- 内存: 8GB
- 存储: 100GB SSD
- 带宽: 5Mbps
- 操作系统: Ubuntu 22.04 LTS / CentOS 8+

**推荐配置：**
- CPU: 8核
- 内存: 16GB
- 存储: 200GB SSD
- 带宽: 10Mbps+
- 操作系统: Ubuntu 22.04 LTS

**云服务商参考：**
- 阿里云: ECS 计算型 c7 (4核8G约¥200/月)
- 腾讯云: 标准型 S5 (4核8G约¥180/月)
- AWS: t3.xlarge (4核16G约$150/月)

### 1.2 前置准备

```bash
# 1. 更新系统
sudo apt update && sudo apt upgrade -y

# 2. 安装Docker和Docker Compose
curl -fsSL https://get.docker.com | bash
sudo usermod -aG docker $USER
sudo systemctl enable docker
sudo systemctl start docker

# 3. 安装Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 4. 验证安装
docker --version
docker-compose --version

# 5. 安装其他工具
sudo apt install -y git vim curl wget ufw
```

### 1.3 部署步骤

```bash
# 1. 克隆仓库
cd /opt
sudo git clone https://github.com/your-org/chainlesschain.git
cd chainlesschain

# 2. 配置环境变量
cp .env.example .env
vim .env
```

**关键环境变量配置：**

```bash
# .env 文件内容

# ==================== 数据库配置 ====================
DB_HOST=postgres
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=chainlesschain
DB_PASSWORD=YOUR_STRONG_PASSWORD_HERE  # 修改为强密码

# ==================== Redis配置 ====================
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=YOUR_REDIS_PASSWORD_HERE  # 修改为强密码

# ==================== LLM配置（选择一个） ====================
# 方案1：阿里云通义千问（推荐，国内速度快）
LLM_PROVIDER=dashscope
LLM_MODEL=qwen-turbo
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxx  # 在 https://dashscope.aliyun.com 获取

# 方案2：智谱AI（ChatGLM）
# LLM_PROVIDER=zhipu
# LLM_MODEL=glm-4
# ZHIPU_API_KEY=xxxxxxxxxxxxx  # 在 https://open.bigmodel.cn 获取

# 方案3：OpenAI（国际版）
# LLM_PROVIDER=openai
# LLM_MODEL=gpt-4o-mini
# OPENAI_API_KEY=sk-xxxxxxxxxxxxx

# ==================== 向量数据库 ====================
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# ==================== 文件存储 ====================
PROJECTS_ROOT_PATH=/data/projects

# ==================== 日志配置 ====================
LOG_LEVEL=INFO
LOG_PATH=/var/log/chainlesschain

# ==================== JWT认证（移动端/Web端必需） ====================
JWT_SECRET=YOUR_RANDOM_JWT_SECRET_AT_LEAST_32_CHARS  # 生成强密钥
JWT_EXPIRATION=86400  # 24小时

# ==================== CORS配置 ====================
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

**生成强密码/密钥的方法：**

```bash
# 生成随机密码
openssl rand -base64 32

# 生成JWT密钥
openssl rand -hex 64
```

### 1.4 启动服务

```bash
# 使用云端LLM模式启动
docker-compose -f docker-compose.cloud.yml up -d

# 查看启动日志
docker-compose -f docker-compose.cloud.yml logs -f

# 检查服务状态
docker-compose -f docker-compose.cloud.yml ps
```

**预期输出：**
```
NAME                              STATUS    PORTS
chainlesschain_ai_service         Up        0.0.0.0:8001->8000/tcp
chainlesschain_project_service    Up        0.0.0.0:9090->9090/tcp
chainlesschain_postgres           Up        0.0.0.0:5432->5432/tcp
chainlesschain_redis              Up        0.0.0.0:6379->6379/tcp
chainlesschain_qdrant             Up        0.0.0.0:6333->6333/tcp
```

### 1.5 健康检查

```bash
# 检查AI服务
curl http://localhost:8001/health
# 预期输出: {"status":"ok","llm_provider":"dashscope","model":"qwen-turbo"}

# 检查Project服务
curl http://localhost:9090/actuator/health
# 预期输出: {"status":"UP"}

# 检查数据库连接
docker exec chainlesschain_postgres psql -U chainlesschain -d chainlesschain -c "SELECT 1"

# 检查Redis
docker exec chainlesschain_redis redis-cli -a YOUR_REDIS_PASSWORD ping
```

---

## 📦 方案二：自建LLM部署（GPU服务器）

### 2.1 服务器要求

**最低配置：**
- CPU: 8核
- 内存: 32GB
- GPU: NVIDIA RTX 3090 (24GB VRAM)
- 存储: 500GB SSD
- 带宽: 10Mbps
- 操作系统: Ubuntu 22.04 LTS

**推荐配置：**
- CPU: 16核
- 内存: 64GB
- GPU: NVIDIA RTX 4090 / A100 (40GB+ VRAM)
- 存储: 1TB NVMe SSD
- 带宽: 20Mbps+

### 2.2 GPU驱动安装

```bash
# 1. 安装NVIDIA驱动
sudo apt install -y nvidia-driver-535
sudo reboot

# 2. 验证驱动
nvidia-smi

# 3. 安装NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt update
sudo apt install -y nvidia-container-toolkit
sudo systemctl restart docker

# 4. 验证GPU在Docker中可用
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### 2.3 部署步骤

```bash
# 1. 使用完整Docker Compose配置
docker-compose up -d

# 2. 下载LLM模型（首次运行）
docker exec chainlesschain-ollama ollama pull qwen2:7b

# 可选：下载其他模型
docker exec chainlesschain-ollama ollama pull llama3:8b
docker exec chainlesschain-ollama ollama pull mistral:7b

# 3. 验证Ollama
curl http://localhost:11434/api/tags
```

### 2.4 性能优化

```bash
# 编辑 docker-compose.yml，为Ollama添加GPU配置
# 在 ollama 服务下添加：
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

---

## 🔒 安全加固

### 3.1 防火墙配置

```bash
# 启用UFW防火墙
sudo ufw enable

# 允许SSH（修改为你的SSH端口）
sudo ufw allow 22/tcp

# 允许HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 不要直接暴露数据库和内部服务端口
# PostgreSQL (5432), Redis (6379), Qdrant (6333) 只允许内部访问

# 重新加载防火墙
sudo ufw reload
sudo ufw status
```

### 3.2 Nginx反向代理 + HTTPS

**安装Nginx：**

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

**配置Nginx反向代理：**

创建 `/etc/nginx/sites-available/chainlesschain`：

```nginx
# HTTP to HTTPS redirect
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS配置
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL证书（由Let's Encrypt自动生成）
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # SSL安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 客户端最大请求体大小（用于文件上传）
    client_max_body_size 100M;

    # Project Service 代理
    location /api/projects/ {
        proxy_pass http://localhost:9090/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket支持（如需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # AI Service 代理
    location /api/ai/ {
        proxy_pass http://localhost:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # AI服务可能需要较长超时
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }

    # 健康检查（不需要认证）
    location /health {
        proxy_pass http://localhost:9090/actuator/health;
        access_log off;
    }

    # API文档（可选，生产环境建议关闭）
    location /swagger-ui/ {
        proxy_pass http://localhost:9090/swagger-ui/;
    }
}
```

**启用配置：**

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/chainlesschain /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 申请SSL证书
sudo certbot --nginx -d api.yourdomain.com

# 重启Nginx
sudo systemctl restart nginx

# 设置自动续期
sudo systemctl enable certbot.timer
```

### 3.3 JWT认证（移动端/Web端必需）

后端已支持JWT认证，需要在客户端实现登录流程：

**登录API：**
```
POST https://api.yourdomain.com/api/projects/auth/login
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "password123"
}

Response:
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 86400
}
```

**后续请求携带Token：**
```
GET https://api.yourdomain.com/api/projects/list
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3.4 数据库安全

```bash
# 禁止PostgreSQL外部访问
# 编辑 docker-compose.cloud.yml，注释掉端口映射
# ports:
#   - "5432:5432"  # 注释这行

# 同样处理Redis
# ports:
#   - "6379:6379"  # 注释这行

# 重新启动服务
docker-compose -f docker-compose.cloud.yml up -d
```

### 3.5 定期备份

创建备份脚本 `/opt/chainlesschain/backup.sh`：

```bash
#!/bin/bash
BACKUP_DIR="/backup/chainlesschain"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份PostgreSQL
docker exec chainlesschain_postgres pg_dump -U chainlesschain chainlesschain | gzip > $BACKUP_DIR/postgres_$DATE.sql.gz

# 备份项目文件
tar -czf $BACKUP_DIR/projects_$DATE.tar.gz /opt/chainlesschain/data/projects

# 备份Qdrant向量数据
tar -czf $BACKUP_DIR/qdrant_$DATE.tar.gz /opt/chainlesschain/data/qdrant

# 删除30天前的备份
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete

echo "Backup completed: $DATE"
```

**设置定时任务：**

```bash
# 添加可执行权限
chmod +x /opt/chainlesschain/backup.sh

# 配置crontab（每天凌晨2点执行）
crontab -e

# 添加以下行
0 2 * * * /opt/chainlesschain/backup.sh >> /var/log/chainlesschain-backup.log 2>&1
```

---

## 📊 监控和日志

### 4.1 日志管理

```bash
# 查看所有服务日志
docker-compose -f docker-compose.cloud.yml logs -f

# 查看特定服务日志
docker-compose -f docker-compose.cloud.yml logs -f ai-service
docker-compose -f docker-compose.cloud.yml logs -f project-service

# 限制日志输出行数
docker-compose -f docker-compose.cloud.yml logs --tail=100 ai-service

# 导出日志到文件
docker-compose -f docker-compose.cloud.yml logs --no-color > /var/log/chainlesschain/all-services.log
```

### 4.2 系统监控

**安装监控工具：**

```bash
# 安装 htop（进程监控）
sudo apt install -y htop

# 安装 iotop（磁盘IO监控）
sudo apt install -y iotop

# 安装 netdata（Web界面监控，可选）
bash <(curl -Ss https://my-netdata.io/kickstart.sh)
# 访问 http://your-ip:19999
```

**Docker监控：**

```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
docker system df

# 清理未使用的资源
docker system prune -a
```

### 4.3 健康检查脚本

创建 `/opt/chainlesschain/health-check.sh`：

```bash
#!/bin/bash

echo "=== ChainlessChain Health Check ==="
echo "Date: $(date)"
echo ""

# 检查AI服务
echo "Checking AI Service..."
AI_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8001/health)
if [ "$AI_STATUS" == "200" ]; then
    echo "✓ AI Service: OK"
else
    echo "✗ AI Service: FAILED (HTTP $AI_STATUS)"
fi

# 检查Project服务
echo "Checking Project Service..."
PROJECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:9090/actuator/health)
if [ "$PROJECT_STATUS" == "200" ]; then
    echo "✓ Project Service: OK"
else
    echo "✗ Project Service: FAILED (HTTP $PROJECT_STATUS)"
fi

# 检查PostgreSQL
echo "Checking PostgreSQL..."
PG_CHECK=$(docker exec chainlesschain_postgres pg_isready -U chainlesschain 2>&1)
if [[ $PG_CHECK == *"accepting connections"* ]]; then
    echo "✓ PostgreSQL: OK"
else
    echo "✗ PostgreSQL: FAILED"
fi

# 检查Redis
echo "Checking Redis..."
REDIS_CHECK=$(docker exec chainlesschain_redis redis-cli -a $REDIS_PASSWORD ping 2>/dev/null)
if [ "$REDIS_CHECK" == "PONG" ]; then
    echo "✓ Redis: OK"
else
    echo "✗ Redis: FAILED"
fi

# 检查磁盘空间
echo ""
echo "Disk Usage:"
df -h /opt/chainlesschain/data

echo ""
echo "=== Health Check Complete ==="
```

**设置定时健康检查：**

```bash
chmod +x /opt/chainlesschain/health-check.sh

# 每小时执行一次
crontab -e
# 添加：
0 * * * * /opt/chainlesschain/health-check.sh >> /var/log/chainlesschain-health.log 2>&1
```

---

## 🔄 更新和维护

### 5.1 更新应用

```bash
cd /opt/chainlesschain

# 1. 拉取最新代码
git pull origin main

# 2. 停止服务
docker-compose -f docker-compose.cloud.yml down

# 3. 备份数据（重要！）
/opt/chainlesschain/backup.sh

# 4. 重新构建镜像
docker-compose -f docker-compose.cloud.yml build --no-cache

# 5. 启动服务
docker-compose -f docker-compose.cloud.yml up -d

# 6. 验证服务
docker-compose -f docker-compose.cloud.yml ps
/opt/chainlesschain/health-check.sh
```

### 5.2 数据库迁移

```bash
# 如果有新的数据库迁移脚本，Flyway会自动执行
# 查看迁移历史
docker exec chainlesschain_postgres psql -U chainlesschain -d chainlesschain -c "SELECT * FROM flyway_schema_history"
```

### 5.3 回滚操作

```bash
# 1. 停止服务
docker-compose -f docker-compose.cloud.yml down

# 2. 恢复数据库
gunzip < /backup/chainlesschain/postgres_YYYYMMDD_HHMMSS.sql.gz | docker exec -i chainlesschain_postgres psql -U chainlesschain chainlesschain

# 3. 恢复项目文件
tar -xzf /backup/chainlesschain/projects_YYYYMMDD_HHMMSS.tar.gz -C /

# 4. 恢复Qdrant
tar -xzf /backup/chainlesschain/qdrant_YYYYMMDD_HHMMSS.tar.gz -C /

# 5. 回退代码
git checkout <commit-hash>
docker-compose -f docker-compose.cloud.yml build
docker-compose -f docker-compose.cloud.yml up -d
```

---

## 📱 移动端/客户端配置

### 6.1 移动端API配置

在移动端应用中配置后端地址：

**iOS (Swift):**
```swift
// Config.swift
struct APIConfig {
    static let baseURL = "https://api.yourdomain.com"
    static let projectsAPI = "\(baseURL)/api/projects"
    static let aiAPI = "\(baseURL)/api/ai"
}
```

**Android (Kotlin):**
```kotlin
// Constants.kt
object APIConstants {
    const val BASE_URL = "https://api.yourdomain.com"
    const val PROJECTS_API = "$BASE_URL/api/projects"
    const val AI_API = "$BASE_URL/api/ai"
}
```

**React Native:**
```javascript
// config.js
export const API_CONFIG = {
  baseURL: 'https://api.yourdomain.com',
  projectsAPI: '/api/projects',
  aiAPI: '/api/ai',
};
```

### 6.2 PC客户端配置

**Electron应用配置：**

修改 `desktop-app-vue/src/main/config.js`：

```javascript
// 云端模式配置
export const CLOUD_MODE = {
  enabled: true,
  apiBaseURL: 'https://api.yourdomain.com',
  projectsAPI: '/api/projects',
  aiAPI: '/api/ai',
  wsURL: 'wss://api.yourdomain.com/ws', // WebSocket（如需要）
};
```

---

## 🚀 性能优化

### 7.1 数据库优化

**PostgreSQL调优：**

创建 `postgres-custom.conf`：

```conf
# 连接数
max_connections = 200

# 内存设置（根据服务器内存调整）
shared_buffers = 4GB
effective_cache_size = 12GB
maintenance_work_mem = 1GB
work_mem = 64MB

# 查询优化
random_page_cost = 1.1
effective_io_concurrency = 200

# 日志
log_min_duration_statement = 1000  # 记录超过1秒的查询
```

在 `docker-compose.cloud.yml` 中挂载配置：

```yaml
postgres:
  volumes:
    - ./postgres-custom.conf:/etc/postgresql/postgresql.conf
  command: postgres -c config_file=/etc/postgresql/postgresql.conf
```

### 7.2 Redis优化

```yaml
redis:
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}
    --maxmemory 2gb
    --maxmemory-policy allkeys-lru
    --appendonly yes
    --appendfsync everysec
```

### 7.3 应用层优化

**Project Service JVM参数：**

修改 `backend/project-service/Dockerfile`：

```dockerfile
ENTRYPOINT ["java",
  "-Xms2g",
  "-Xmx4g",
  "-XX:+UseG1GC",
  "-XX:MaxGCPauseMillis=200",
  "-jar", "app.jar"]
```

**AI Service优化：**

编辑 `docker-compose.cloud.yml`：

```yaml
ai-service:
  environment:
    - WORKERS=4  # 根据CPU核心数调整
    - EMBEDDING_BATCH_SIZE=32
    - MAX_CONCURRENT_REQUESTS=10
```

---

## 💰 成本估算

### 云端LLM模式（推荐）

**服务器成本（按月）：**
- 阿里云ECS 4核8G: ¥200
- 带宽 10Mbps: ¥60
- 云盘 200GB SSD: ¥40
- **小计**: ¥300/月

**LLM API成本（以阿里云通义千问为例）：**
- qwen-turbo: ¥0.002/千tokens (输入), ¥0.006/千tokens (输出)
- 假设每月100万tokens: ¥2 (输入) + ¥6 (输出) = ¥8/月
- **小计**: ¥8-50/月 (根据使用量)

**总成本**: ¥310-350/月

### 自建LLM模式

**服务器成本（按月）：**
- GPU服务器 (RTX 3090): ¥1500-2000/月
- 或购买服务器: ¥30,000 (一次性，折旧5年 = ¥500/月)
- 带宽: ¥60/月
- 电费: ¥200/月 (按0.8元/度计算)
- **小计**: ¥760-2260/月

**适用场景**: 月调用量超过1000万tokens时，自建更经济

---

## ❓ 常见问题

### Q1: 如何切换LLM提供商？

修改 `.env` 文件：

```bash
# 从阿里云切换到智谱AI
LLM_PROVIDER=zhipu
LLM_MODEL=glm-4
ZHIPU_API_KEY=your-api-key

# 重启AI服务
docker-compose -f docker-compose.cloud.yml restart ai-service
```

### Q2: 数据库连接池耗尽怎么办？

增加连接池大小，编辑 `application.yml`：

```yaml
spring:
  datasource:
    hikari:
      maximum-pool-size: 50  # 从20增加到50
```

### Q3: 如何启用HTTPS？

参考"安全加固"章节的Nginx + Let's Encrypt配置。

### Q4: 如何水平扩展？

使用Docker Swarm或Kubernetes：

```bash
# Docker Swarm示例
docker swarm init
docker stack deploy -c docker-compose.cloud.yml chainlesschain

# 扩展AI服务到3个实例
docker service scale chainlesschain_ai-service=3
```

### Q5: 如何监控API调用量和成本？

在AI服务中添加调用统计：

```python
# backend/ai-service/src/middleware/usage_tracker.py
# 记录每次调用的tokens数，存储到Redis
# 定期汇总并导出报表
```

---

## 📞 技术支持

- GitHub Issues: https://github.com/your-org/chainlesschain/issues
- 文档: https://docs.chainlesschain.com
- 邮件: support@chainlesschain.com

---

## 📄 附录

### A. 完整的生产环境 docker-compose.yml

参见项目根目录下的 `docker-compose.production.yml`（将在下一步创建）

### B. 监控告警配置

可集成 Prometheus + Grafana + AlertManager 实现完整监控，详见 `MONITORING.md`（可选）

### C. 性能基准测试

使用 Apache JMeter 或 K6 进行压力测试，详见 `PERFORMANCE_TESTING.md`（可选）

---

**部署方案文档版本**: v1.0.0
**最后更新**: 2025-01-01
**维护者**: ChainlessChain Team

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：ChainlessChain 后端云端部署方案。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
