# ChainlessChain 部署方案总览

> 选择最适合你的部署方式

## 🎯 部署方案对比

| 方案 | 难度 | 时间 | 适用场景 | 文档 |
|------|------|------|----------|------|
| **一键部署** | ⭐ | 10分钟 | 生产环境，完整系统 | `ONE_CLICK_DEPLOY.md` |
| 快速部署 | ⭐⭐ | 5分钟 | 仅后端服务 | `QUICK_DEPLOY.md` |
| 详细部署 | ⭐⭐⭐ | 30分钟 | 自定义配置 | `DEPLOYMENT_GUIDE.md` |
| 监控部署 | ⭐⭐ | 3分钟 | 仅监控系统 | `MONITORING_QUICK_START.md` |

---

## 🚀 方案一：一键部署（推荐）

### 特点
- ✅ **完整系统**：后端 + 监控 + 安全配置
- ✅ **交互式配置**：脚本引导完成所有配置
- ✅ **自动化**：自动安装依赖、配置服务
- ✅ **生产就绪**：包含防火墙、Nginx、SSL

### 部署命令

```bash
cd /opt
git clone https://github.com/your-org/chainlesschain.git
cd chainlesschain
chmod +x deploy/deploy-all.sh
sudo bash deploy/deploy-all.sh
```

### 部署内容

```
后端服务:
  ✓ AI Service (FastAPI)
  ✓ Project Service (Spring Boot)
  ✓ PostgreSQL
  ✓ Redis
  ✓ Qdrant

监控系统:
  ✓ Prometheus
  ✓ Grafana
  ✓ AlertManager
  ✓ Node Exporter
  ✓ cAdvisor
  ✓ PostgreSQL Exporter
  ✓ Redis Exporter

安全配置:
  ✓ 防火墙 (UFW)
  ✓ Nginx 反向代理
  ✓ SSL 证书 (Let's Encrypt)
```

### 适用场景
- 🏢 生产环境部署
- 📱 移动端后端服务
- 🌐 Web应用后端
- 👥 团队协作项目

**👉 [查看详细文档](ONE_CLICK_DEPLOY.md)**

---

## ⚡ 方案二：快速部署（仅后端）

### 特点
- ✅ **快速启动**：5分钟部署后端服务
- ✅ **云端LLM**：使用阿里云等云LLM服务
- ✅ **轻量级**：不包含监控系统
- ✅ **简单配置**：最少配置项

### 部署命令

```bash
cd /opt/chainlesschain
chmod +x deploy/deploy.sh
bash deploy/deploy.sh production
```

### 部署内容

```
✓ AI Service
✓ Project Service
✓ PostgreSQL
✓ Redis
✓ Qdrant
```

### 适用场景
- 🧪 测试环境
- 💻 开发环境
- 📦 最小化部署
- 🏃 快速原型验证

**👉 [查看详细文档](QUICK_DEPLOY.md)**

---

## 📊 方案三：监控部署（仅监控）

### 特点
- ✅ **专业监控**：Prometheus + Grafana + AlertManager
- ✅ **50+告警规则**：开箱即用
- ✅ **多渠道通知**：邮件、钉钉、企业微信
- ✅ **预置仪表盘**：系统概览、服务性能

### 部署命令

```bash
cd /opt/chainlesschain
chmod +x deploy/setup-monitoring.sh
sudo bash deploy/setup-monitoring.sh
```

### 部署内容

```
✓ Prometheus (指标收集)
✓ Grafana (可视化)
✓ AlertManager (告警)
✓ Node Exporter (系统监控)
✓ cAdvisor (容器监控)
✓ PostgreSQL Exporter
✓ Redis Exporter
```

### 适用场景
- 📈 已有后端，需要添加监控
- 🔍 运维监控
- 🚨 告警通知
- 📊 性能分析

**👉 [查看详细文档](MONITORING_QUICK_START.md)**

---

## 🔧 方案四：详细部署（自定义）

### 特点
- ✅ **完全控制**：自定义每个配置项
- ✅ **深入理解**：了解每个组件的作用
- ✅ **灵活配置**：根据需求调整
- ✅ **学习资源**：适合深入学习

### 部署步骤

1. **环境准备**
2. **配置环境变量**
3. **选择部署模式**（云端LLM / 自建LLM / 混合）
4. **安全加固**
5. **性能优化**
6. **监控配置**

### 适用场景
- 🎓 学习和研究
- 🏗️ 特殊需求定制
- 🔬 性能优化
- 🛠️ 故障排查

**👉 [查看详细文档](DEPLOYMENT_GUIDE.md)**

---

## 🛠️ 部署脚本说明

### 主部署脚本

| 脚本 | 功能 | 使用场景 |
|------|------|----------|
| `deploy/deploy-all.sh` | 完整系统一键部署 | 生产环境 |
| `deploy/deploy.sh` | 后端服务部署 | 测试/开发 |
| `deploy/setup-monitoring.sh` | 监控系统部署 | 添加监控 |

### 运维脚本

| 脚本 | 功能 | 使用方法 |
|------|------|----------|
| `deploy/backup.sh` | 数据备份 | `bash deploy/backup.sh` |
| `deploy/restore.sh` | 数据恢复 | `bash deploy/restore.sh TIMESTAMP` |
| `deploy/health-check.sh` | 健康检查 | `bash deploy/health-check.sh` |

### Nginx/SSL脚本

| 脚本 | 功能 | 使用方法 |
|------|------|----------|
| `deploy/nginx/ssl-setup.sh` | SSL证书配置 | `sudo bash deploy/nginx/ssl-setup.sh yourdomain.com` |

---

## 📦 Docker Compose 配置文件

### 生产环境配置

| 文件 | 用途 | 启动命令 |
|------|------|----------|
| `docker-compose.production.yml` | 后端服务（生产） | `docker-compose -f docker-compose.production.yml up -d` |
| `docker-compose.monitoring.yml` | 监控系统 | `docker-compose -f docker-compose.monitoring.yml up -d` |
| `docker-compose.full.yml` | 完整系统 | `docker-compose -f docker-compose.full.yml up -d` |

### 其他配置

| 文件 | 用途 |
|------|------|
| `docker-compose.yml` | 本地开发（含Ollama） |
| `docker-compose.cloud.yml` | 云端模式（仅云LLM） |

---

## 🎯 快速决策指南

### 我应该选择哪个方案？

```
问题1: 是否是生产环境？
  ├─ 是 → 问题2
  └─ 否 → 方案二：快速部署

问题2: 是否需要监控系统？
  ├─ 是 → 方案一：一键部署 ⭐推荐
  └─ 否 → 方案二：快速部署

问题3: 是否有GPU服务器？
  ├─ 是 → 使用 docker-compose.yml (含Ollama)
  └─ 否 → 使用云端LLM模式 (推荐)

问题4: 是否需要自定义配置？
  ├─ 是 → 方案四：详细部署
  └─ 否 → 方案一：一键部署
```

### 推荐配置

**个人项目/测试环境：**
- 部署方案：快速部署
- 服务器：4核8G
- LLM：阿里云通义千问
- 成本：¥210/月

**小团队/生产环境：**
- 部署方案：一键部署 ⭐
- 服务器：8核16G
- LLM：阿里云通义千问
- 监控：完整监控栈
- 成本：¥470/月

**企业级/大规模：**
- 部署方案：详细部署 + 自定义
- 服务器：16核32G + GPU
- LLM：自建Ollama
- 监控：完整监控 + 自定义告警
- 成本：¥2000+/月

---

## 📋 部署前检查清单

### 必需项

- [ ] 服务器已准备（Ubuntu 22.04 推荐）
- [ ] 服务器可访问（SSH）
- [ ] 服务器配置满足要求（4核8G+）
- [ ] LLM API密钥已获取
- [ ] 域名已解析（如需HTTPS）

### 推荐项

- [ ] 备份现有数据
- [ ] 规划数据存储位置
- [ ] 准备SMTP邮箱（告警通知）
- [ ] 准备钉钉机器人（可选）
- [ ] 阅读相关文档

---

## 🆘 获取帮助

### 文档资源

- **一键部署**: `ONE_CLICK_DEPLOY.md`
- **快速部署**: `QUICK_DEPLOY.md`
- **详细部署**: `DEPLOYMENT_GUIDE.md`
- **监控系统**: `MONITORING.md`
- **项目说明**: `CLAUDE.md`

### 技术支持

- **GitHub Issues**: https://github.com/your-org/chainlesschain/issues
- **邮件**: support@chainlesschain.com
- **文档**: https://docs.chainlesschain.com

### 常见问题

- **部署失败**: 查看日志 `docker-compose logs`
- **服务无法访问**: 检查防火墙和端口
- **监控无数据**: 验证Prometheus配置
- **告警未发送**: 检查AlertManager配置

---

## 🎓 学习路径

### 初学者
1. 阅读 `ONE_CLICK_DEPLOY.md`
2. 运行一键部署脚本
3. 访问Grafana查看监控
4. 测试API调用

### 中级用户
1. 阅读 `DEPLOYMENT_GUIDE.md`
2. 了解各组件作用
3. 自定义监控规则
4. 配置告警通知

### 高级用户
1. 研究 Docker Compose 配置
2. 优化系统性能
3. 自定义Grafana仪表盘
4. 开发自定义告警规则

---

**选择适合你的方案，开始部署吧！** 🚀

有任何问题，请查看相应文档或联系技术支持。
