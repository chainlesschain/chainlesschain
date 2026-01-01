# 监控系统快速开始

> 3分钟快速部署ChainlessChain监控系统

## 🎯 监控能力

- ✅ **实时服务监控** - AI服务、Project服务、数据库、Redis
- ✅ **系统资源监控** - CPU、内存、磁盘、网络
- ✅ **容器监控** - Docker容器资源使用
- ✅ **智能告警** - 邮件、钉钉、企业微信通知
- ✅ **可视化面板** - Grafana专业仪表盘

## 🚀 一键部署

```bash
# 1. 进入项目目录
cd /opt/chainlesschain

# 2. 运行监控部署脚本
chmod +x deploy/setup-monitoring.sh
sudo bash deploy/setup-monitoring.sh
```

脚本会引导你完成：
1. ✅ 环境检查
2. ✅ 创建监控目录
3. ✅ 配置告警通知（邮件/钉钉）
4. ✅ 设置Grafana密码
5. ✅ 启动所有监控服务
6. ✅ 验证服务状态

## 📊 访问监控面板

部署完成后，访问以下地址：

### Grafana（可视化仪表盘）
- **URL**: `http://your-server-ip:3000`
- **用户名**: `admin`
- **密码**: 部署时设置的密码
- **功能**: 查看监控图表、配置仪表盘

### Prometheus（指标查询）
- **URL**: `http://your-server-ip:9090`
- **功能**: 查询原始指标、调试PromQL

### AlertManager（告警管理）
- **URL**: `http://your-server-ip:9093`
- **功能**: 查看告警历史、配置告警规则

## 🔔 配置告警通知

### 方式1: 邮件通知

**Gmail配置：**

```bash
# 编辑AlertManager配置
vim monitoring/alertmanager/alertmanager.yml

# 修改以下内容
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'your-email@gmail.com'
  smtp_auth_username: 'your-email@gmail.com'
  smtp_auth_password: 'your-app-password'  # Gmail应用专用密码

# 重启AlertManager
docker-compose -f docker-compose.monitoring.yml restart alertmanager
```

### 方式2: 钉钉通知

1. **创建钉钉机器人：**
   - 打开钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义
   - 安全设置选择"自定义关键词"，输入：告警
   - 复制Webhook地址

2. **配置钉钉Webhook：**

```bash
# 编辑钉钉配置
vim monitoring/dingtalk/config.yml

# 修改webhook URL
targets:
  webhook1:
    url: https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN

# 重启钉钉webhook服务
docker-compose -f docker-compose.monitoring.yml restart dingtalk-webhook
```

3. **测试告警：**

```bash
# 发送测试告警
curl -X POST http://localhost:9093/api/v1/alerts \
  -H 'Content-Type: application/json' \
  -d '[{
    "labels": {"alertname": "TestAlert", "severity": "warning"},
    "annotations": {"summary": "这是一条测试告警"}
  }]'
```

## 📈 导入Grafana仪表盘

### 预装仪表盘

系统已自动加载"ChainlessChain系统概览"仪表盘，包含：
- 服务状态
- CPU/内存使用率
- HTTP请求统计
- 错误率监控

### 导入社区仪表盘

1. 登录Grafana
2. 点击左侧菜单 `+` → `Import`
3. 输入仪表盘ID或上传JSON

**推荐仪表盘：**

| 名称 | ID | 说明 |
|------|-----|------|
| Node Exporter Full | 1860 | 完整的Linux系统监控 |
| Docker Container & Host | 10619 | Docker容器监控 |
| Spring Boot 2.1 Statistics | 10280 | Spring Boot应用监控 |
| PostgreSQL Database | 9628 | PostgreSQL详细监控 |
| Redis Dashboard | 11835 | Redis监控 |

## 🔥 查看告警

### 1. 在Grafana中查看

- 点击左侧 `Alerting` → `Alert rules`
- 查看所有告警规则和当前状态

### 2. 在Prometheus中查看

访问 `http://your-server-ip:9090/alerts`

### 3. 在AlertManager中查看

访问 `http://your-server-ip:9093/#/alerts`

## 📊 重要监控指标

### 服务可用性

```promql
# 服务是否在线（1=在线, 0=离线）
up{job="ai-service"}
up{job="project-service"}
up{job="postgres"}
up{job="redis"}
```

### 系统资源

```promql
# CPU使用率
100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 内存使用率
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# 磁盘使用率
(1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) * 100
```

### 应用性能

```promql
# HTTP请求速率
sum(rate(http_requests_total[5m])) by (service)

# HTTP错误率
(sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))) * 100

# P95响应时间
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))
```

## 🎨 自定义仪表盘

### 创建新仪表盘

1. 登录Grafana
2. 点击 `+` → `Dashboard` → `Add new panel`
3. 输入PromQL查询
4. 选择可视化类型（图表、表格、仪表等）
5. 保存仪表盘

**示例：创建LLM调用统计面板**

```promql
# LLM调用次数
sum(rate(llm_requests_total[5m])) by (provider, model)

# LLM成功率
(sum(rate(llm_requests_total[5m])) - sum(rate(llm_requests_failed_total[5m]))) / sum(rate(llm_requests_total[5m])) * 100

# LLM平均响应时间
rate(llm_request_duration_seconds_sum[5m]) / rate(llm_request_duration_seconds_count[5m])
```

## ⚙️ 常用操作

### 查看监控服务状态

```bash
docker-compose -f docker-compose.monitoring.yml ps
```

### 查看监控日志

```bash
# 所有服务日志
docker-compose -f docker-compose.monitoring.yml logs -f

# 特定服务日志
docker logs -f chainlesschain_prometheus
docker logs -f chainlesschain_grafana
docker logs -f chainlesschain_alertmanager
```

### 重启监控服务

```bash
# 重启所有监控服务
docker-compose -f docker-compose.monitoring.yml restart

# 重启特定服务
docker-compose -f docker-compose.monitoring.yml restart prometheus
```

### 停止监控服务

```bash
docker-compose -f docker-compose.monitoring.yml down
```

### 更新监控配置

```bash
# 修改配置文件后重新加载
# Prometheus
curl -X POST http://localhost:9090/-/reload

# AlertManager
curl -X POST http://localhost:9093/-/reload

# Grafana需要重启
docker-compose -f docker-compose.monitoring.yml restart grafana
```

## 🛡️ 安全配置（生产环境）

### 1. 配置Nginx反向代理

```nginx
# /etc/nginx/sites-available/monitoring

server {
    listen 443 ssl http2;
    server_name monitoring.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/monitoring.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/monitoring.yourdomain.com/privkey.pem;

    # Grafana
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Prometheus（建议限制访问）
    location /prometheus/ {
        auth_basic "Prometheus";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:9090/;
    }
}
```

### 2. 修改默认密码

```bash
# Grafana密码
# 登录后在 User → Change password 修改

# 或通过命令行修改
docker exec -it chainlesschain_grafana grafana-cli admin reset-admin-password newpassword
```

### 3. 启用IP白名单

```yaml
# docker-compose.monitoring.yml
# 限制端口只能本地访问
ports:
  - "127.0.0.1:9090:9090"  # Prometheus
  - "127.0.0.1:3000:3000"  # Grafana
  - "127.0.0.1:9093:9093"  # AlertManager
```

## 📞 故障排查

### 问题1: 无法访问Grafana

```bash
# 检查服务状态
docker ps | grep grafana

# 查看日志
docker logs chainlesschain_grafana

# 检查端口
netstat -tlnp | grep 3000
```

### 问题2: Prometheus无数据

```bash
# 检查目标状态
curl http://localhost:9090/api/v1/targets | jq

# 测试抓取目标
curl http://localhost:9090/metrics
curl http://localhost:8001/metrics  # AI服务
curl http://localhost:9090/actuator/prometheus  # Project服务
```

### 问题3: 告警未触发

```bash
# 检查告警规则
curl http://localhost:9090/api/v1/rules | jq

# 查看活动告警
curl http://localhost:9090/api/v1/alerts | jq

# 检查AlertManager
curl http://localhost:9093/api/v2/alerts | jq
```

## 📚 进一步学习

- **完整监控文档**: `MONITORING.md`
- **Prometheus官方文档**: https://prometheus.io/docs/
- **Grafana官方文档**: https://grafana.com/docs/
- **PromQL教程**: https://prometheus.io/docs/prometheus/latest/querying/basics/

## ✅ 检查清单

部署完成后，确认以下项：

- [ ] Grafana可以访问（http://your-ip:3000）
- [ ] Prometheus可以访问（http://your-ip:9090）
- [ ] AlertManager可以访问（http://your-ip:9093）
- [ ] Grafana中可以看到"ChainlessChain系统概览"仪表盘
- [ ] Prometheus中所有target状态为UP
- [ ] 邮件/钉钉告警通知已配置
- [ ] 已发送测试告警并成功接收
- [ ] Grafana管理员密码已修改
- [ ] （生产环境）已配置Nginx反向代理和HTTPS

---

**祝贺！** 🎉 你已成功部署ChainlessChain监控系统！

有任何问题请参考 `MONITORING.md` 或联系技术支持。
