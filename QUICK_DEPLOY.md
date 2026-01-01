# ChainlessChain 快速部署指南

> 5分钟快速部署ChainlessChain后端到云服务器

## 📌 部署前准备

### 1. 服务器要求

- **云服务器**: 阿里云/腾讯云/AWS等，4核8G起
- **操作系统**: Ubuntu 22.04 LTS（推荐）
- **域名**: 已解析到服务器IP（例如: `api.yourdomain.com`）

### 2. 获取LLM API密钥

选择一个云LLM提供商并获取API密钥：

**推荐选项（按性价比排序）：**

1. **阿里云通义千问**（推荐）
   - 注册: https://dashscope.console.aliyun.com/
   - 定价: ¥0.002/千tokens（输入），¥0.006/千tokens（输出）
   - 特点: 国内速度快，价格便宜，质量好

2. **智谱AI（ChatGLM）**
   - 注册: https://open.bigmodel.cn/
   - 定价: GLM-4-Flash 免费
   - 特点: 提供免费额度，适合测试

3. **OpenAI**
   - 注册: https://platform.openai.com/
   - 定价: $0.15/M tokens（gpt-4o-mini输入）
   - 特点: 质量最高，需要国际信用卡

---

## 🚀 快速部署（5分钟）

### 步骤1: 连接服务器并安装Docker

```bash
# SSH连接到服务器
ssh root@your-server-ip

# 安装Docker（一键脚本）
curl -fsSL https://get.docker.com | bash

# 安装Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 验证安装
docker --version
docker-compose --version
```

### 步骤2: 克隆项目

```bash
cd /opt
git clone https://github.com/your-org/chainlesschain.git
cd chainlesschain
```

### 步骤3: 配置环境变量

```bash
# 复制生产环境配置模板
cp deploy/.env.production.example .env

# 编辑配置文件
vim .env
```

**必须修改的配置：**

```bash
# 1. 数据库密码（生成强密码）
DB_PASSWORD=$(openssl rand -base64 32)
REDIS_PASSWORD=$(openssl rand -base64 32)

# 2. JWT密钥（生成随机密钥）
JWT_SECRET=$(openssl rand -hex 64)

# 3. LLM配置（选择一个）
# 使用阿里云通义千问
LLM_PROVIDER=dashscope
LLM_MODEL=qwen-turbo
DASHSCOPE_API_KEY=sk-your-api-key-here  # 替换为真实API Key

# 或使用智谱AI
# LLM_PROVIDER=zhipu
# LLM_MODEL=glm-4
# ZHIPU_API_KEY=your-api-key-here

# 4. CORS配置（替换为你的域名）
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

**快速配置脚本（自动生成密码）：**

```bash
# 自动生成密码并配置
cat > .env << EOF
ENVIRONMENT=production
LOG_LEVEL=INFO

# 数据库配置
DB_HOST=postgres
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=chainlesschain
DB_PASSWORD=$(openssl rand -base64 32)

# Redis配置
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=$(openssl rand -base64 32)

# LLM配置（阿里云通义千问）
LLM_PROVIDER=dashscope
LLM_MODEL=qwen-turbo
DASHSCOPE_API_KEY=sk-YOUR-API-KEY-HERE  # 需要手动替换

# JWT配置
JWT_SECRET=$(openssl rand -hex 64)
JWT_EXPIRATION=86400

# Embedding配置
EMBEDDING_MODEL=BAAI/bge-base-zh-v1.5
EMBEDDING_PROVIDER=local

# 向量数据库
QDRANT_HOST=qdrant
QDRANT_PORT=6333

# 文件存储
PROJECTS_ROOT_PATH=/data/projects

# CORS
CORS_ALLOWED_ORIGINS=https://yourdomain.com

# HuggingFace镜像
HF_ENDPOINT=https://hf-mirror.com
EOF

# 然后编辑 .env 文件，替换 DASHSCOPE_API_KEY
vim .env
```

### 步骤4: 一键部署

```bash
# 给脚本添加执行权限
chmod +x deploy/*.sh

# 运行部署脚本
bash deploy/deploy.sh production
```

部署脚本会自动：
- ✅ 检查环境和依赖
- ✅ 创建数据目录
- ✅ 拉取Docker镜像
- ✅ 构建应用镜像
- ✅ 启动所有服务
- ✅ 运行健康检查

预计时间：3-5分钟

### 步骤5: 验证部署

```bash
# 检查服务状态
docker-compose -f docker-compose.production.yml ps

# 运行健康检查
bash deploy/health-check.sh

# 测试API
curl http://localhost:8001/health
curl http://localhost:9090/actuator/health
```

**预期输出：**
```json
// AI服务
{"status":"ok","llm_provider":"dashscope","model":"qwen-turbo"}

// Project服务
{"status":"UP"}
```

---

## 🔒 配置HTTPS（推荐）

### 方式1: 使用自动化脚本

```bash
# 运行SSL配置脚本
sudo bash deploy/nginx/ssl-setup.sh api.yourdomain.com
```

脚本会自动：
- 安装Nginx和Certbot
- 申请Let's Encrypt SSL证书
- 配置反向代理
- 设置自动续期

### 方式2: 手动配置

```bash
# 1. 安装Nginx和Certbot
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# 2. 复制Nginx配置
sudo cp deploy/nginx/chainlesschain.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/chainlesschain.conf /etc/nginx/sites-enabled/

# 3. 修改域名
sudo sed -i 's/api.yourdomain.com/YOUR-DOMAIN/g' /etc/nginx/sites-available/chainlesschain.conf

# 4. 申请SSL证书
sudo certbot --nginx -d api.yourdomain.com

# 5. 重启Nginx
sudo systemctl restart nginx

# 6. 测试HTTPS
curl https://api.yourdomain.com/health
```

---

## 🔧 配置防火墙

```bash
# 启用UFW防火墙
sudo ufw enable

# 允许SSH
sudo ufw allow 22/tcp

# 允许HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 重新加载防火墙
sudo ufw reload

# 查看状态
sudo ufw status
```

---

## 📊 设置定时备份

```bash
# 给备份脚本添加执行权限
chmod +x deploy/backup.sh

# 编辑crontab
crontab -e

# 添加以下行（每天凌晨2点备份）
0 2 * * * cd /opt/chainlesschain && bash deploy/backup.sh >> /var/log/chainlesschain-backup.log 2>&1
```

---

## ✅ 部署完成检查清单

- [ ] Docker和Docker Compose已安装
- [ ] .env文件已正确配置（数据库密码、LLM API Key、JWT密钥）
- [ ] 所有服务已启动（5个容器：postgres, redis, qdrant, ai-service, project-service）
- [ ] 健康检查全部通过
- [ ] Nginx反向代理已配置
- [ ] SSL证书已申请并配置（HTTPS可访问）
- [ ] 防火墙规则已设置
- [ ] 定时备份已配置

---

## 📱 移动端/客户端配置

部署完成后，在移动端或客户端配置以下API地址：

```javascript
// 移动端配置
const API_CONFIG = {
  baseURL: 'https://api.yourdomain.com',
  projectsAPI: '/api/projects',
  aiAPI: '/api/ai',
};
```

**API端点示例：**
- 创建项目: `POST https://api.yourdomain.com/api/projects/create`
- AI对话: `POST https://api.yourdomain.com/api/ai/chat`
- 健康检查: `GET https://api.yourdomain.com/health`

---

## 🆘 常见问题

### Q1: 服务启动失败

```bash
# 查看日志
docker-compose -f docker-compose.production.yml logs -f

# 常见原因：
# 1. .env配置错误 → 检查LLM API Key是否正确
# 2. 端口被占用 → 使用 netstat -tlnp 检查端口
# 3. 内存不足 → 升级服务器配置
```

### Q2: 无法连接LLM

```bash
# 测试网络连接
curl https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation

# 检查API Key
curl -X POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation \
  -H "Authorization: Bearer YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-turbo","input":{"messages":[{"role":"user","content":"你好"}]}}'
```

### Q3: SSL证书申请失败

```bash
# 检查域名是否正确解析
nslookup api.yourdomain.com

# 检查80端口是否可访问
curl http://api.yourdomain.com

# 手动申请证书
sudo certbot certonly --standalone -d api.yourdomain.com
```

### Q4: 内存占用过高

```bash
# 查看容器资源使用
docker stats

# 优化配置（编辑 docker-compose.production.yml）
# 减少 JVM 内存: -Xmx4g → -Xmx2g
# 减少 worker 数量: WORKERS=4 → WORKERS=2
```

---

## 📚 进一步阅读

- **完整部署文档**: `DEPLOYMENT_GUIDE.md` - 包含详细配置、安全加固、性能优化
- **架构设计**: `CLAUDE.md` - 了解项目架构和开发指南
- **API文档**: 访问 `https://api.yourdomain.com/swagger-ui.html`

---

## 💰 成本估算

**服务器成本（按月）：**
- 阿里云ECS 4核8G: ¥200
- 带宽 10Mbps: ¥60
- 云盘 200GB: ¥40
- **小计**: ¥300/月

**LLM API成本（阿里云通义千问）：**
- 轻度使用（10万tokens/月）: ¥0.8
- 中度使用（100万tokens/月）: ¥8
- 重度使用（1000万tokens/月）: ¥80

**总成本**: ¥308-380/月

---

## 🎉 部署成功！

恭喜你完成了ChainlessChain后端的云端部署！

**下一步：**
1. 配置移动端/客户端连接后端API
2. 创建用户账号和权限
3. 导入初始数据
4. 配置监控告警（可选）

**技术支持：**
- GitHub Issues: https://github.com/your-org/chainlesschain/issues
- 邮件: support@chainlesschain.com
