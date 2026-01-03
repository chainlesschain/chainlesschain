# ChainlessChain 监控和告警系统

> 基于 Prometheus + Grafana + AlertManager 的完整监控方案

## 📋 系统架构

```
                    ┌─────────────────┐
                    │    Grafana      │
                    │  (可视化面板)    │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Prometheus    │
                    │  (指标收集)      │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼────┐  ┌─────▼─────┐  ┌────▼────┐
      │ Exporters  │  │ Services  │  │ Alerts  │
      │(系统/容器) │  │  (应用)   │  │Manager  │
      └────────────┘  └───────────┘  └─────┬───┘
                                            │
                              ┌─────────────┴─────────────┐
                              │                           │
                      ┌───────▼──────┐          ┌────────▼────────┐
                      │   Email      │          │  钉钉/企业微信   │
                      │  (邮件通知)  │          │  (即时通知)     │
                      └──────────────┘          └─────────────────┘
```

## 🎯 监控内容

### 1. 服务监控
- ✅ AI服务（FastAPI）- 可用性、响应时间、错误率
- ✅ Project服务（Spring Boot）- 可用性、JVM指标、SQL性能
- ✅ PostgreSQL - 连接数、查询性能、死锁
- ✅ Redis - 内存使用、连接数、命中率
- ✅ Qdrant - 向量数据库状态
- ✅ Nginx - 请求量、响应时间、错误率

### 2. 系统监控
- ✅ CPU使用率、负载
- ✅ 内存使用率
- ✅ 磁盘使用率、IO
- ✅ 网络流量
- ✅ 进程状态

### 3. 容器监控
- ✅ 容器CPU/内存使用
- ✅ 容器重启次数
- ✅ 容器网络流量
- ✅ 容器存储使用

### 4. 业务监控
- ✅ LLM调用次数、成功率、响应时间
- ✅ API请求量、错误率
- ✅ 用户认证成功/失败
- ✅ 数据库查询性能

### 5. 安全监控
- ✅ 异常登录尝试
- ✅ 异常IP访问
- ✅ API滥用检测

## 🚀 快速部署

### 步骤1: 准备配置文件

```bash
cd /opt/chainlesschain

# 编辑监控配置（可选）
vim monitoring/prometheus/prometheus.yml
vim monitoring/alertmanager/alertmanager.yml
```

### 步骤2: 配置告警通知

**编辑 `monitoring/alertmanager/alertmanager.yml`：**

```yaml
# 配置SMTP邮件
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'alerts@yourdomain.com'
  smtp_auth_username: 'alerts@yourdomain.com'
  smtp_auth_password: 'your-app-password'

# 配置接收邮箱
receivers:
  - name: 'default-receiver'
    email_configs:
      - to: 'ops-team@yourdomain.com'
```

**配置钉钉通知（可选）：**

1. 在钉钉群创建自定义机器人
2. 获取Webhook URL
3. 编辑 `monitoring/dingtalk/config.yml`：

```yaml
targets:
  webhook1:
    url: https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN
```

### 步骤3: 启动监控系统

```bash
# 启动监控栈
docker-compose -f docker-compose.monitoring.yml up -d

# 查看服务状态
docker-compose -f docker-compose.monitoring.yml ps

# 查看日志
docker-compose -f docker-compose.monitoring.yml logs -f
```

### 步骤4: 访问监控面板

**Grafana（可视化面板）：**
- URL: `http://your-server-ip:3000`
- 默认用户名: `admin`
- 默认密码: `admin123`（首次登录后需修改）

**Prometheus（指标查询）：**
- URL: `http://your-server-ip:9090`

**AlertManager（告警管理）：**
- URL: `http://your-server-ip:9093`

### 步骤5: 配置Nginx反向代理（推荐）

```nginx
# Grafana
location /grafana/ {
    proxy_pass http://127.0.0.1:3000/;
    proxy_set_header Host $host;
}

# Prometheus
location /prometheus/ {
    proxy_pass http://127.0.0.1:9090/;
    proxy_set_header Host $host;
}
```

然后访问：
- Grafana: `https://yourdomain.com/grafana/`
- Prometheus: `https://yourdomain.com/prometheus/`

## 📊 Grafana仪表盘

### 预装仪表盘

1. **系统概览** - 服务状态、CPU、内存、磁盘
2. **服务性能** - HTTP请求、响应时间、错误率
3. **数据库监控** - PostgreSQL连接数、查询性能
4. **容器监控** - Docker容器资源使用
5. **LLM监控** - LLM调用统计、成本分析

### 导入社区仪表盘

Grafana官方仪表盘库：https://grafana.com/grafana/dashboards/

**推荐仪表盘：**

1. **Node Exporter Full** (ID: 1860)
   - 完整的系统监控
   - 在Grafana中导入：`Dashboard → Import → 1860`

2. **Docker Container & Host Metrics** (ID: 10619)
   - Docker容器和主机监控
   - 导入ID: `10619`

3. **Spring Boot 2.1 Statistics** (ID: 10280)
   - Spring Boot应用监控
   - 导入ID: `10280`

4. **PostgreSQL Database** (ID: 9628)
   - PostgreSQL详细监控
   - 导入ID: `9628`

5. **Redis Dashboard** (ID: 11835)
   - Redis监控
   - 导入ID: `11835`

## 🔔 告警规则说明

### 严重告警（Critical）

立即通知，需要紧急处理：

| 告警名称 | 触发条件 | 通知方式 |
|---------|---------|---------|
| AIServiceDown | AI服务宕机1分钟 | 邮件+钉钉 |
| ProjectServiceDown | Project服务宕机1分钟 | 邮件+钉钉 |
| PostgreSQLDown | 数据库宕机1分钟 | 邮件+钉钉 |
| RedisDown | Redis宕机1分钟 | 邮件+钉钉 |
| DiskAlmostFull | 磁盘使用率>95% | 邮件+钉钉 |

### 警告告警（Warning）

需要关注，但不紧急：

| 告警名称 | 触发条件 | 通知方式 |
|---------|---------|---------|
| HighCPUUsage | CPU使用率>80%，持续5分钟 | 邮件 |
| HighMemoryUsage | 内存使用率>85%，持续5分钟 | 邮件 |
| HighDiskUsage | 磁盘使用率>85%，持续5分钟 | 邮件 |
| ContainerHighMemory | 容器内存>90%，持续5分钟 | 邮件 |
| PostgreSQLTooManyConnections | 数据库连接数>150 | 邮件 |
| HighErrorRate | HTTP 5xx错误率>5% | 邮件 |
| LLMHighFailureRate | LLM调用失败率>10% | 邮件 |

### 自定义告警规则

编辑 `monitoring/prometheus/rules/alerts.yml` 添加新规则：

```yaml
groups:
  - name: custom_alerts
    rules:
      - alert: YourCustomAlert
        expr: your_metric > threshold
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "告警摘要"
          description: "详细描述"
```

重新加载规则：

```bash
# 重新加载Prometheus配置
curl -X POST http://localhost:9090/-/reload
```

## 📧 配置通知渠道

### 1. 邮件通知

**Gmail配置：**

1. 开启两步验证
2. 生成应用专用密码：https://myaccount.google.com/apppasswords
3. 配置AlertManager：

```yaml
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'your-email@gmail.com'
  smtp_auth_username: 'your-email@gmail.com'
  smtp_auth_password: 'your-app-password'
  smtp_require_tls: true
```

**企业邮箱配置：**

```yaml
global:
  smtp_smarthost: 'smtp.exmail.qq.com:465'
  smtp_from: 'alerts@yourdomain.com'
  smtp_auth_username: 'alerts@yourdomain.com'
  smtp_auth_password: 'your-password'
  smtp_require_tls: true
```

### 2. 钉钉通知

**步骤：**

1. 打开钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义
2. 设置安全方式（关键词或加签）
3. 复制Webhook地址
4. 配置 `monitoring/dingtalk/config.yml`
5. 在AlertManager中配置webhook

```yaml
receivers:
  - name: 'dingtalk-ops'
    webhook_configs:
      - url: 'http://dingtalk-webhook:8060/dingtalk/webhook1/send'
```

### 3. 企业微信通知

```yaml
receivers:
  - name: 'wechat-ops'
    wechat_configs:
      - corp_id: 'your-corp-id'
        to_user: '@all'
        agent_id: 'your-agent-id'
        api_secret: 'your-api-secret'
```

### 4. Slack通知

```yaml
receivers:
  - name: 'slack-ops'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
        channel: '#alerts'
        title: '{{ .GroupLabels.alertname }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'
```

### 5. PagerDuty（24/7值班）

```yaml
receivers:
  - name: 'pagerduty-oncall'
    pagerduty_configs:
      - service_key: 'your-pagerduty-service-key'
        description: '{{ .GroupLabels.alertname }}'
```

## 🔧 高级配置

### 1. 启用Spring Boot Actuator

**添加依赖（已包含）：**

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

**配置 application.yml：**

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
```

访问指标：`http://localhost:9090/actuator/prometheus`

### 2. 为FastAPI添加Prometheus指标

**安装库：**

```bash
pip install prometheus-client
```

**添加中间件（backend/ai-service/main.py）：**

```python
from prometheus_client import Counter, Histogram, generate_latest, REGISTRY
from starlette.middleware.base import BaseHTTPMiddleware
import time

# 定义指标
REQUEST_COUNT = Counter('http_requests_total', 'Total HTTP requests', ['method', 'endpoint', 'status'])
REQUEST_DURATION = Histogram('http_request_duration_seconds', 'HTTP request duration', ['method', 'endpoint'])
LLM_REQUESTS = Counter('llm_requests_total', 'Total LLM requests', ['provider', 'model'])
LLM_FAILURES = Counter('llm_requests_failed_total', 'Failed LLM requests', ['provider', 'model'])

# 添加中间件
class PrometheusMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start_time = time.time()
        response = await call_next(request)
        duration = time.time() - start_time

        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=request.url.path,
            status=response.status_code
        ).inc()

        REQUEST_DURATION.labels(
            method=request.method,
            endpoint=request.url.path
        ).observe(duration)

        return response

app.add_middleware(PrometheusMiddleware)

# 添加metrics端点
@app.get("/metrics")
async def metrics():
    return Response(generate_latest(REGISTRY), media_type="text/plain")
```

### 3. 配置数据保留策略

**Prometheus数据保留：**

编辑 `docker-compose.monitoring.yml`：

```yaml
prometheus:
  command:
    - '--storage.tsdb.retention.time=30d'  # 保留30天
    - '--storage.tsdb.retention.size=50GB'  # 或限制大小
```

**定期清理：**

```bash
# 删除指定时间范围的数据
curl -X POST -g 'http://localhost:9090/api/v1/admin/tsdb/delete_series?match[]={job="old-job"}&start=2024-01-01T00:00:00Z&end=2024-06-30T23:59:59Z'

# 清理墓碑数据
curl -X POST http://localhost:9090/api/v1/admin/tsdb/clean_tombstones
```

## 📈 性能优化

### 1. Prometheus性能调优

```yaml
# prometheus.yml
global:
  scrape_interval: 15s  # 生产环境可调整为30s或60s
  evaluation_interval: 15s

# 减少高基数标签
metric_relabel_configs:
  - source_labels: [__name__]
    regex: 'high_cardinality_metric_.*'
    action: drop
```

### 2. Grafana性能优化

```ini
# grafana.ini
[dashboards]
default_home_dashboard_path = /etc/grafana/provisioning/dashboards/json/overview.json

[dataproxy]
timeout = 300
keep_alive_seconds = 300

[database]
max_idle_conn = 25
max_open_conn = 300
```

### 3. 监控系统资源限制

```yaml
# docker-compose.monitoring.yml
prometheus:
  deploy:
    resources:
      limits:
        memory: 2G
        cpus: '1.0'
```

## 🛠️ 故障排查

### 问题1: Prometheus无法抓取目标

```bash
# 检查Prometheus日志
docker logs chainlesschain_prometheus

# 检查目标状态
curl http://localhost:9090/api/v1/targets

# 测试目标连接
docker exec chainlesschain_prometheus wget -O- http://ai-service:8000/metrics
```

### 问题2: AlertManager未发送告警

```bash
# 检查AlertManager日志
docker logs chainlesschain_alertmanager

# 查看活动告警
curl http://localhost:9093/api/v2/alerts

# 测试邮件配置
docker exec -it chainlesschain_alertmanager amtool check-config /etc/alertmanager/alertmanager.yml
```

### 问题3: Grafana无数据

1. 检查Prometheus数据源配置
2. 验证Prometheus有数据：`http://localhost:9090/graph`
3. 检查查询语句是否正确
4. 查看Grafana日志：`docker logs chainlesschain_grafana`

### 问题4: 监控系统占用资源过高

```bash
# 查看资源使用
docker stats

# 减少抓取频率
# 编辑 prometheus.yml，增加 scrape_interval

# 减少数据保留时间
# 编辑 docker-compose.monitoring.yml，调整 retention.time
```

## 📚 常用查询（PromQL）

### 系统监控

```promql
# CPU使用率
100 - (avg(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 内存使用率
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# 磁盘使用率
(1 - (node_filesystem_avail_bytes / node_filesystem_size_bytes)) * 100

# 网络流量
rate(node_network_receive_bytes_total[5m])
```

### 服务监控

```promql
# HTTP请求速率
sum(rate(http_requests_total[5m])) by (service)

# HTTP错误率
sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100

# P95响应时间
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# 服务可用性
up{job=~"ai-service|project-service"}
```

### 数据库监控

```promql
# PostgreSQL连接数
sum(pg_stat_activity_count)

# Redis内存使用率
(redis_memory_used_bytes / redis_memory_max_bytes) * 100

# 慢查询数量
rate(pg_stat_database_tup_returned[5m])
```

## 📞 技术支持

- 监控系统问题：ops-team@chainlesschain.com
- Prometheus文档：https://prometheus.io/docs/
- Grafana文档：https://grafana.com/docs/
- AlertManager文档：https://prometheus.io/docs/alerting/latest/

---

**监控系统版本**: v1.0.0
**最后更新**: 2025-01-01
**维护者**: ChainlessChain DevOps Team
