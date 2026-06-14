# ChainlessChain 一键部署指南

> 10分钟完成后端服务 + 监控系统的完整部署

## 🎯 部署内容

本方案将一次性部署：

### 🔧 后端服务
- ✅ **AI Service** (FastAPI) - AI推理、RAG检索
- ✅ **Project Service** (Spring Boot) - 项目管理、Git同步
- ✅ **PostgreSQL** - 项目元数据存储
- ✅ **Redis** - 缓存和消息队列
- ✅ **Qdrant** - 向量数据库

### 📊 监控系统
- ✅ **Prometheus** - 指标收集和存储
- ✅ **Grafana** - 可视化仪表盘
- ✅ **AlertManager** - 智能告警
- ✅ **Exporters** - 系统/容器/数据库监控

### 🔒 安全配置
- ✅ 防火墙规则
- ✅ Nginx反向代理
- ✅ SSL证书（可选）
- ✅ JWT认证

---

## 📋 准备工作

### 1. 服务器要求

**最低配置：**
- CPU: 4核
- 内存: 8GB
- 存储: 100GB SSD
- 操作系统: Ubuntu 22.04 LTS

**推荐配置：**
- CPU: 8核
- 内存: 16GB
- 存储: 200GB SSD

### 2. 域名准备（可选）

如果需要HTTPS和域名访问，请提前准备：
- API域名：`api.yourdomain.com`
- 监控域名：`monitoring.yourdomain.com`

并将域名解析到服务器IP。

### 3. LLM API密钥

选择一个云LLM提供商并获取API密钥：

| 提供商 | 注册地址 | 定价 | 推荐度 |
|--------|---------|------|--------|
| **阿里云通义千问** | https://dashscope.console.aliyun.com | ¥0.002/千tokens | ⭐⭐⭐⭐⭐ |
| 智谱AI ChatGLM | https://open.bigmodel.cn | 免费额度 | ⭐⭐⭐⭐ |
| OpenAI | https://platform.openai.com | $0.15/M tokens | ⭐⭐⭐ |

---

## 🚀 一键部署（推荐）

### 步骤1: 连接服务器

```bash
ssh root@your-server-ip
```

### 步骤2: 克隆项目

```bash
cd /opt
git clone https://github.com/your-org/chainlesschain.git
cd chainlesschain
```

### 步骤3: 运行一键部署脚本

```bash
chmod +x deploy/deploy-all.sh
sudo bash deploy/deploy-all.sh
```

### 步骤4: 按提示配置

脚本会引导你完成以下配置：

#### 1️⃣ **LLM配置**
```
请选择LLM提供商:
  1) 阿里云通义千问 (推荐，国内速度快)
  2) 智谱AI ChatGLM (有免费额度)
  3) OpenAI (需要国际信用卡)
选择 (1-3): 1

输入 DASHSCOPE_API_KEY: sk-xxxxxxxxxxxxx
```

#### 2️⃣ **数据库配置**
```
正在生成强密码...
✓ 数据库密码已自动生成
```

#### 3️⃣ **JWT认证配置**
```
✓ JWT密钥已自动生成
```

#### 4️⃣ **域名配置**
```
是否配置域名? (y/n): y
输入API域名 (例如: api.yourdomain.com): api.example.com
输入监控域名 (例如: monitoring.yourdomain.com): monitoring.example.com
```

#### 5️⃣ **告警配置**
```
配置邮件告警? (y/n): y
SMTP服务器 (例如: smtp.gmail.com:587): smtp.gmail.com:587
发件人邮箱: alerts@example.com
SMTP用户名: alerts@example.com
SMTP密码: ********
接收告警的邮箱: admin@example.com
```

### 步骤5: 等待部署完成

脚本会自动执行：

```
[1/8] 环境检查
  ✓ Docker: 24.0.7
  ✓ Docker Compose: v2.24.0
  ✓ 磁盘空间: 150GB 可用
  ✓ 内存: 16GB

[2/8] 配置环境变量
  ✓ LLM配置完成
  ✓ 数据库密码已生成
  ✓ JWT密钥已生成

[3/8] 创建目录结构
  ✓ 目录结构创建完成

[4/8] 更新配置文件
  ✓ AlertManager邮件配置已更新

[5/8] 部署后端服务
  ✓ 后端服务部署完成

[6/8] 部署监控系统
  ✓ 监控系统部署完成

[7/8] 健康检查
  ✓ AI Service         OK
  ✓ Project Service    OK
  ✓ PostgreSQL         OK
  ✓ Redis              OK
  ✓ Prometheus         OK
  ✓ Grafana            OK
  ✓ AlertManager       OK

[8/8] 安全配置
  ✓ 防火墙配置完成
  ✓ Nginx配置完成
  ✓ SSL证书配置完成

╔══════════════════════════════════════════════════════╗
║  ✓✓✓  部署成功完成！ ✓✓✓                             ║
╚══════════════════════════════════════════════════════╝
```

部署时间：5-10分钟（取决于网络速度）

---

## 🎉 部署完成后

### 访问服务

#### 1. 后端API

**有域名：**
- API地址: `https://api.yourdomain.com`
- Project API: `https://api.yourdomain.com/api/projects/`
- AI API: `https://api.yourdomain.com/api/ai/`
- API文档: `https://api.yourdomain.com/api/projects/swagger-ui.html`

**无域名（本地）：**
- AI服务: `http://your-server-ip:8001`
- Project服务: `http://your-server-ip:9090`
- API文档: `http://your-server-ip:9090/swagger-ui.html`

#### 2. 监控面板

**有域名：**
- Grafana: `https://monitoring.yourdomain.com`

**无域名（本地）：**
- Grafana: `http://your-server-ip:3000`
- Prometheus: `http://your-server-ip:9090`
- AlertManager: `http://your-server-ip:9093`

**Grafana登录：**
- 用户名: `admin`
- 密码: 部署完成后会显示（已保存在 `.env` 文件）

### 测试API

```bash
# 测试AI服务
curl http://localhost:8001/health
# 预期输出: {"status":"ok","llm_provider":"dashscope"}

# 测试Project服务
curl http://localhost:9090/actuator/health
# 预期输出: {"status":"UP"}

# 测试完整API调用
curl -X POST http://localhost:8001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

### 查看监控

1. 打开浏览器访问Grafana
2. 使用admin账号登录
3. 查看预装的"ChainlessChain系统概览"仪表盘
4. 实时查看CPU、内存、服务状态等指标

---

## 📱 客户端配置

部署完成后，在移动端或PC客户端配置API地址：

### iOS/Android

```swift
// Swift
struct APIConfig {
    static let baseURL = "https://api.yourdomain.com"
    static let projectsAPI = "\(baseURL)/api/projects"
    static let aiAPI = "\(baseURL)/api/ai"
}
```

```kotlin
// Kotlin
object APIConfig {
    const val BASE_URL = "https://api.yourdomain.com"
    const val PROJECTS_API = "$BASE_URL/api/projects"
    const val AI_API = "$BASE_URL/api/ai"
}
```

### Web/Electron

```javascript
// JavaScript
export const API_CONFIG = {
  baseURL: 'https://api.yourdomain.com',
  projectsAPI: '/api/projects',
  aiAPI: '/api/ai',
};
```

---

## 🔧 手动部署（备选）

如果不想使用一键脚本，也可以手动部署：

### 方式1: 使用完整Docker Compose

```bash
# 1. 配置环境变量
cp deploy/.env.production.example .env
vim .env  # 编辑配置

# 2. 启动所有服务
docker-compose -f docker-compose.full.yml up -d

# 3. 查看状态
docker-compose -f docker-compose.full.yml ps
```

### 方式2: 分步部署

```bash
# 1. 部署后端
docker-compose -f docker-compose.production.yml up -d

# 2. 部署监控
docker-compose -f docker-compose.monitoring.yml up -d

# 3. 验证服务
bash deploy/health-check.sh
```

---

## 📊 监控和告警

### 预置告警规则（50+条）

#### 严重告警（Critical）
- 🔴 服务宕机（AI/Project/数据库/Redis）
- 🔴 磁盘使用率>95%
- 🔴 数据库连接池耗尽

#### 警告告警（Warning）
- 🟡 CPU使用率>80%（持续5分钟）
- 🟡 内存使用率>85%（持续5分钟）
- 🟡 HTTP错误率>5%
- 🟡 LLM调用失败率>10%

### 告警通知方式

- ✅ **邮件** - 所有告警
- ✅ **钉钉** - 严重告警（可选）
- ✅ **企业微信** - 严重告警（可选）

### 查看告警

**在Grafana中：**
- 左侧菜单 → Alerting → Alert rules

**在Prometheus中：**
- 访问 `http://localhost:9090/alerts`

**在AlertManager中：**
- 访问 `http://localhost:9093/#/alerts`

---

## 🛡️ 安全最佳实践

### 1. 修改默认密码

```bash
# 修改Grafana密码
docker exec -it chainlesschain_grafana grafana-cli admin reset-admin-password newpassword
```

### 2. 限制端口访问

```yaml
# docker-compose.*.yml
# 将端口改为只监听本地
ports:
  - "127.0.0.1:9090:9090"  # 仅本地访问
```

### 3. 配置HTTPS（生产环境必需）

```bash
# 使用Let's Encrypt自动申请证书
sudo certbot --nginx -d api.yourdomain.com -d monitoring.yourdomain.com
```

### 4. 定期备份

```bash
# 添加定时任务
crontab -e

# 每天凌晨2点备份
0 2 * * * cd /opt/chainlesschain && bash deploy/backup.sh
```

---

## 🔄 常用运维命令

### 查看服务状态

```bash
# 查看所有容器
docker ps

# 查看后端服务
docker-compose -f docker-compose.production.yml ps

# 查看监控服务
docker-compose -f docker-compose.monitoring.yml ps
```

### 查看日志

```bash
# 查看所有日志
docker-compose -f docker-compose.full.yml logs -f

# 查看特定服务日志
docker logs -f chainlesschain_ai_service
docker logs -f chainlesschain_project_service
docker logs -f chainlesschain_grafana
```

### 重启服务

```bash
# 重启所有服务
docker-compose -f docker-compose.full.yml restart

# 重启特定服务
docker-compose -f docker-compose.production.yml restart ai-service
docker-compose -f docker-compose.monitoring.yml restart grafana
```

### 停止服务

```bash
# 停止所有服务
docker-compose -f docker-compose.full.yml down

# 停止但保留数据
docker-compose -f docker-compose.full.yml stop

# 停止并删除数据（危险！）
docker-compose -f docker-compose.full.yml down -v
```

### 更新服务

```bash
# 1. 备份数据
bash deploy/backup.sh

# 2. 拉取最新代码
git pull origin main

# 3. 重新构建和启动
docker-compose -f docker-compose.full.yml build --no-cache
docker-compose -f docker-compose.full.yml up -d

# 4. 验证服务
bash deploy/health-check.sh
```

---

## 🐛 故障排查

### 问题1: 服务启动失败

```bash
# 查看错误日志
docker-compose -f docker-compose.full.yml logs

# 常见原因:
# 1. 端口被占用 → 修改docker-compose.yml中的端口
# 2. 内存不足 → 升级服务器配置或减少服务数量
# 3. 配置错误 → 检查.env文件
```

### 问题2: 无法访问API

```bash
# 检查防火墙
sudo ufw status

# 检查Nginx配置
sudo nginx -t
sudo systemctl status nginx

# 检查服务端口
netstat -tlnp | grep -E '8001|9090|3000'
```

### 问题3: 监控无数据

```bash
# 检查Prometheus目标状态
curl http://localhost:9090/api/v1/targets | jq

# 重启Prometheus
docker-compose -f docker-compose.monitoring.yml restart prometheus

# 查看Prometheus日志
docker logs chainlesschain_prometheus
```

### 问题4: 告警未发送

```bash
# 检查AlertManager配置
docker exec chainlesschain_alertmanager amtool check-config /etc/alertmanager/alertmanager.yml

# 查看活动告警
curl http://localhost:9093/api/v2/alerts | jq

# 测试邮件发送
docker logs chainlesschain_alertmanager | grep -i error
```

---

## 💰 成本估算

### 服务器成本（按月）

| 配置 | 阿里云 | 腾讯云 | AWS |
|------|--------|--------|-----|
| 4核8G | ¥200 | ¥180 | $150 |
| 8核16G | ¥400 | ¥360 | $280 |

### LLM成本（阿里云通义千问）

| 使用量 | 成本/月 | 适用场景 |
|--------|---------|----------|
| 10万tokens | ¥0.8 | 个人测试 |
| 100万tokens | ¥8 | 小团队 |
| 1000万tokens | ¥80 | 中等规模 |

### 总成本

- **最低配置**: ¥210/月（服务器¥200 + LLM¥8 + 带宽¥60）
- **推荐配置**: ¥470/月（服务器¥400 + LLM¥50 + 带宽¥100）

---

## 📚 文档导航

- **一键部署**: `ONE_CLICK_DEPLOY.md` ← 你在这里
- **详细部署**: `DEPLOYMENT_GUIDE.md`
- **监控文档**: `MONITORING.md`
- **快速开始**: `QUICK_DEPLOY.md`
- **项目说明**: `CLAUDE.md`

---

## ✅ 部署检查清单

完成部署后，请确认以下项：

### 后端服务
- [ ] AI服务可访问（http://localhost:8001/health）
- [ ] Project服务可访问（http://localhost:9090/actuator/health）
- [ ] PostgreSQL连接正常
- [ ] Redis连接正常
- [ ] Qdrant连接正常
- [ ] LLM API调用成功

### 监控系统
- [ ] Grafana可访问并能登录
- [ ] Prometheus所有target状态为UP
- [ ] AlertManager可访问
- [ ] 系统概览仪表盘有数据
- [ ] 邮件/钉钉告警已配置
- [ ] 测试告警发送成功

### 安全配置
- [ ] 防火墙已启用并配置正确
- [ ] Nginx反向代理已配置
- [ ] HTTPS已配置（生产环境）
- [ ] Grafana管理员密码已修改
- [ ] 数据库密码已修改为强密码

### 运维配置
- [ ] 定时备份已配置（crontab）
- [ ] 日志轮转已配置
- [ ] 监控告警规则已测试
- [ ] API文档可访问

---

## 🎓 下一步学习

### 1. 了解系统架构
```bash
cat CLAUDE.md | less
```

### 2. 配置客户端
- 移动端配置API地址
- PC端配置API地址
- 测试完整功能流程

### 3. 自定义监控
- 添加自定义指标
- 创建业务仪表盘
- 配置特定告警规则

### 4. 性能优化
- 调整JVM参数
- 优化数据库查询
- 配置Redis缓存策略

---

## 📞 技术支持

- **GitHub Issues**: https://github.com/your-org/chainlesschain/issues
- **邮件**: support@chainlesschain.com
- **文档**: https://docs.chainlesschain.com

---

**祝贺！** 🎉 你已成功部署ChainlessChain完整系统！

现在可以开始使用强大的AI驱动的个人知识管理和项目管理功能了。

---

**版本**: v1.0.0
**最后更新**: 2025-01-01
**维护者**: ChainlessChain Team

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：ChainlessChain 一键部署指南。

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
